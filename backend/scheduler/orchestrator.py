# backend/scheduler/orchestrator.py
"""
Implementación 4: Orquestador de Tareas y Planificador (APScheduler / Python)
- Sincroniza publicaciones programadas, descargas de Drive y ejecución con Playwright.
- Monitoreo del margen de tolerancia y envío de alertas escalonadas a Telegram.
- Verificación de metas diarias por cuenta y despacho de reporte consolidado.
"""
import os
import logging
import requests
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger

from config import (
    SUPABASE_URL, SUPABASE_KEY,
    TELEGRAM_BOT_TOKEN, TELEGRAM_GROUP_ID, TELEGRAM_ADMIN_CHAT_ID,
    TOLERANCIA_MINUTOS, FRECUENCIA_AVISOS_MINUTOS, MAX_REINTENTOS_ALERTA,
    HORA_REPORTE_METAS_DIARIAS, SCRAPER_INTERVALO_MINUTOS
)
from storage.drive_downloader import DriveDownloader
from scraper.silent_scraper import SilentScraper

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("Orchestrator")

class TaskOrchestrator:
    def __init__(self):
        self.scheduler = BackgroundScheduler()
        self.downloader = DriveDownloader()
        self.scraper = SilentScraper()
        
        # Estado local de demostración / caché en memoria si Supabase no está conectado con credenciales activas
        self.local_videos: List[Dict[str, Any]] = []
        self.local_accounts: List[Dict[str, Any]] = []

    def send_telegram_alert(self, chat_id: str, message: str) -> bool:
        """Envía mensaje directo a la API de Telegram."""
        if not TELEGRAM_BOT_TOKEN or not chat_id:
            logger.warning("Telegram Bot Token o Chat ID no configurados.")
            return False

        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        try:
            res = requests.post(url, json={
                "chat_id": chat_id,
                "text": message,
                "parse_mode": "HTML"
            }, timeout=10)
            data = res.json()
            if data.get("ok"):
                logger.info(f"Mensaje de Telegram enviado con éxito a {chat_id}")
                return True
            else:
                logger.error(f"Error devuelto por Telegram: {data.get('description')}")
        except Exception as e:
            logger.error(f"Error conectando con Telegram API: {e}")
        return False

    def check_and_publish_scheduled_videos(self):
        """
        Revisa las publicaciones programadas cuya fecha/hora se haya cumplido.
        1. Descarga el video de Drive a la carpeta temporal (Implementación 5).
        2. Cambia estado a ENVIADO.
        3. En producción dispara el script de Playwright.
        """
        logger.info("Verificando cola de publicaciones programadas...")
        now = datetime.utcnow()

        # En entorno real se consulta a Supabase: supabase.table('publicaciones').select('*').eq('estado', 'PROGRAMADO')...
        for video in self.local_videos:
            if video.get("estado") == "PROGRAMADO":
                prog_date = video.get("programado_para")
                if isinstance(prog_date, str):
                    prog_date = datetime.fromisoformat(prog_date.replace("Z", "+00:00"))

                if prog_date <= now:
                    logger.info(f"Publicación alcanzada para video: '{video.get('titulo')}' (ID: {video.get('id')})")
                    
                    # 1. Descargar video desde Drive
                    download_res = self.downloader.download_video(
                        video.get("drive_file_url", ""),
                        video.get("titulo", "video")
                    )
                    video["local_video_path"] = download_res.get("local_path")

                    # 2. Cambiar a ENVIADO
                    video["estado"] = "ENVIADO"
                    video["enviado_en"] = now.isoformat()
                    logger.info(f"Video '{video.get('titulo')}' pasado a estado ENVIADO. Listo para confirmación.")

    def check_tolerance_and_alerts(self):
        """
        Monitorea videos ENVIADOS que superen el margen de tolerancia.
        - Llama al Scraper Silencioso (Implementación 3).
        - Si confirma: marca PUBLICADO, extrae métricas y limpia video local.
        - Si no confirma: envía aviso a Telegram e incrementa reintentos.
        """
        logger.info("Comprobando tolerancia y confirmaciones de scraper...")
        now = datetime.utcnow()

        for video in self.local_videos:
            if video.get("estado") in ("ENVIADO", "VERIFICACION_PENDIENTE"):
                prog_date = video.get("programado_para")
                if isinstance(prog_date, str):
                    prog_date = datetime.fromisoformat(prog_date.replace("Z", "+00:00"))

                delay_minutes = int((now - prog_date).total_seconds() / 60)

                # Si excedió el margen de tolerancia
                if delay_minutes >= TOLERANCIA_MINUTOS:
                    logger.info(f"Video '{video.get('titulo')}' excedió tolerancia ({delay_minutes} min). Ejecutando Scraper Silencioso...")

                    # 1. Verificación silenciosa headless sin abrir ventanas
                    check_result = self.scraper.verify_post_live(
                        platform="instagram",
                        profile_url="https://instagram.com/brandofficial",
                        expected_title=video.get("titulo", ""),
                        post_url=video.get("post_url_publica")
                    )

                    if check_result.get("is_live"):
                        # Confirmado en vivo
                        video["estado"] = "PUBLICADO"
                        video["publicado_en"] = now.isoformat()
                        video["post_url_publica"] = check_result.get("post_url")
                        
                        # Extraer métricas
                        metrics = self.scraper.extract_metrics("instagram", check_result.get("post_url"))
                        video["vistas_obtenidas"] = metrics.get("vistas", 1000)
                        
                        # Limpieza automática del video en disco (Implementación 5)
                        if video.get("local_video_path"):
                            self.downloader.cleanup_video(video["local_video_path"])

                        logger.info(f"Video '{video.get('titulo')}' confirmado PUBLICADO con éxito.")
                    else:
                        # No confirmado: Alertar al grupo de Telegram
                        reintentos = video.get("reintentos_alerta", 0) + 1
                        video["reintentos_alerta"] = reintentos

                        if reintentos >= MAX_REINTENTOS_ALERTA:
                            video["estado"] = "ERROR_DE_RED"
                            urgencia_msg = f"""
🚨 <b>ALERTA CRÍTICA DE PUBLICACIÓN</b>
━━━━━━━━━━━━━━━━━━━━
⚠️ El video <b>'{video.get('titulo')}'</b> ha agotado los {MAX_REINTENTOS_ALERTA} intentos de verificación.
⏱️ Retraso acumulado: <b>{delay_minutes} minutos</b>.
❗ <i>Por favor revise manualmente la sesión de la cuenta o el log de Playwright.</i>
"""
                            self.send_telegram_alert(TELEGRAM_ADMIN_CHAT_ID or TELEGRAM_GROUP_ID, urgencia_msg)
                        else:
                            aviso_msg = f"""
⚠️ <b>AVISO DE RETRASO EN PUBLICACIÓN</b>
━━━━━━━━━━━━━━━━━━━━
🎬 <b>Video:</b> {video.get('titulo')}
🕒 <b>Retraso:</b> {delay_minutes} minutos
📢 <i>Aviso #{reintentos} de {MAX_REINTENTOS_ALERTA} enviado al grupo de monitoreo.</i>
"""
                            self.send_telegram_alert(TELEGRAM_GROUP_ID, aviso_msg)

    def check_daily_quotas_report(self):
        """
        Calcula la meta diaria de publicaciones para cada cuenta y despacha
        el resumen de videos faltantes a Telegram.
        """
        logger.info("Generando reporte diario de metas y cuotas de publicación...")
        
        report_msg = f"""
📊 <b>REPORTE DIARIO DE METAS Y PUBLICACIONES FALTANTES</b>
━━━━━━━━━━━━━━━━━━━━
📅 <b>Fecha:</b> {datetime.now().strftime('%Y-%m-%d')}
"""
        any_missing = False
        for acc in self.local_accounts:
            username = acc.get("username", "cuenta")
            platform = acc.get("plataforma", "red").upper()
            target = acc.get("publicaciones_estimadas_diarias", 3)
            published = acc.get("published_today", 1)
            missing = max(0, target - published)
            
            if missing > 0:
                any_missing = True
                report_msg += f"\n👤 <b>@{username}</b> ({platform}):\n• Publicados: <b>{published}/{target}</b>\n• ⚠️ Faltan: <b>{missing} video(s)</b>\n"
            else:
                report_msg += f"\n👤 <b>@{username}</b> ({platform}):\n• ✅ Meta cumplida: <b>{published}/{target}</b>\n"

        if any_missing:
            report_msg += "\n⏰ <i>Por favor subir o programar el contenido restante antes de finalizar el día.</i>"
        else:
            report_msg += "\n🎉 <i>¡Todas las cuentas han alcanzado su cuota estimada de hoy!</i>"

        self.send_telegram_alert(TELEGRAM_GROUP_ID, report_msg)

    def start(self):
        """Inicia los cron jobs programados del orquestador."""
        logger.info("Iniciando Orquestador de Tareas en segundo plano...")
        
        # 1. Revisión de publicaciones cada 1 minuto
        self.scheduler.add_job(
            self.check_and_publish_scheduled_videos,
            trigger=IntervalTrigger(minutes=1),
            id="job_publish_videos",
            replace_existing=True
        )

        # 2. Revisión de tolerancia y scraper cada 5 minutos
        self.scheduler.add_job(
            self.check_tolerance_and_alerts,
            trigger=IntervalTrigger(minutes=SCRAPER_INTERVALO_MINUTOS),
            id="job_tolerance_scraper",
            replace_existing=True
        )

        # 3. Reporte de meta diaria a la hora configurada (ej. 19:00)
        hour, minute = HORA_REPORTE_METAS_DIARIAS.split(":") if ":" in HORA_REPORTE_METAS_DIARIAS else ("19", "00")
        self.scheduler.add_job(
            self.check_daily_quotas_report,
            trigger=CronTrigger(hour=int(hour), minute=int(minute)),
            id="job_daily_quotas",
            replace_existing=True
        )

        self.scheduler.start()
        logger.info(f"Orquestador iniciado: Publicador (1m), Tolerancia/Scraper ({SCRAPER_INTERVALO_MINUTOS}m), Metas Diarias ({HORA_REPORTE_METAS_DIARIAS})")

    def stop(self):
        """Detiene el orquestador."""
        self.scheduler.shutdown()
        logger.info("Orquestador detenido.")
