# backend/main.py
"""
Punto de Entrada del Backend de AutoPublish:
Demostración e Inicialización de:
- Implementación 3: Scraper Silencioso Headless (Verificación & Métricas sin abrir navegadores)
- Implementación 4: Orquestador y Planificador de Tareas (APScheduler, Tolerancia, Metas Diarias)
- Implementación 5: Gestor Local de Archivos Multimedia (Drive Downloader con Limpieza)
"""
import time
import logging
from datetime import datetime, timedelta
from scheduler.orchestrator import TaskOrchestrator
from storage.drive_downloader import DriveDownloader
from scraper.silent_scraper import SilentScraper

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("AutoPublishBackend")

def main():
    logger.info("=== INICIANDO BACKEND DE AUTOPUBLISH ===")
    
    # 1. Probar Implementación 5: Gestor de Descarga de Drive
    downloader = DriveDownloader()
    logger.info("\n--- [TEST IMPL 5] Gestor Multimedia / Descargador Drive ---")
    download_res = downloader.download_video(
        drive_url_or_id="https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/view",
        video_title="Reel_Verano_Test"
    )
    logger.info(f"Resultado descarga: {download_res}")

    # 2. Probar Implementación 3: Scraper Silencioso (Headless)
    scraper = SilentScraper()
    logger.info("\n--- [TEST IMPL 3] Scraper Silencioso (Sin abrir navegadores) ---")
    verify_res = scraper.verify_post_live(
        platform="instagram",
        profile_url="https://instagram.com/brandofficial",
        expected_title="Reel_Verano_Test"
    )
    logger.info(f"Verificación de publicación: {verify_res}")

    metrics_res = scraper.extract_metrics("instagram", verify_res.get("post_url", ""))
    logger.info(f"Métricas extraídas en segundo plano: {metrics_res}")

    # 3. Limpiar archivo temporal post-verificación (Implementación 5)
    if download_res.get("local_path"):
        downloader.cleanup_video(download_res["local_path"])

    # 4. Iniciar Implementación 4: Orquestador de Tareas
    logger.info("\n--- [TEST IMPL 4] Orquestador de Tareas & Telegram Bot ---")
    orchestrator = TaskOrchestrator()
    
    # Cargar datos de prueba para validación
    orchestrator.local_accounts = [
        {"username": "brandofficial", "plataforma": "instagram", "publicaciones_estimadas_diarias": 3, "published_today": 1},
        {"username": "mybrandtiktok", "plataforma": "tiktok", "publicaciones_estimadas_diarias": 4, "published_today": 4},
        {"username": "brandpage", "plataforma": "facebook", "publicaciones_estimadas_diarias": 2, "published_today": 0},
    ]
    
    orchestrator.local_videos = [
        {
            "id": "v-test-1",
            "titulo": "Lanzamiento Producto Teaser",
            "drive_file_url": "#",
            "programado_para": (datetime.utcnow() - timedelta(minutes=75)).isoformat(),
            "estado": "ENVIADO",
            "reintentos_alerta": 1,
        }
    ]

    # Ejecutar comprobaciones directas
    logger.info("Probando ciclo de tolerancia y alertas...")
    orchestrator.check_tolerance_and_alerts()

    logger.info("Probando ciclo de reporte de metas diarias de Telegram...")
    orchestrator.check_daily_quotas_report()

    logger.info("Iniciando scheduler en segundo plano...")
    orchestrator.start()
    
    logger.info("✅ Todos los módulos 3, 4 y 5 han sido inicializados exitosamente.")
    orchestrator.stop()

if __name__ == "__main__":
    main()
