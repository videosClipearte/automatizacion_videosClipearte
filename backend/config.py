# backend/config.py
import os
from pathlib import Path
from dotenv import load_dotenv

# Cargar .env si existe
load_dotenv()

BASE_DIR = Path(__file__).resolve().parent

# Configuración de Supabase
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://xyzcompany.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...")

# Configuración de Telegram
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "718294819:AAHk_mockTelegramBotToken91823")
TELEGRAM_GROUP_ID = os.getenv("TELEGRAM_GROUP_ID", "-1001928471928")
TELEGRAM_ADMIN_CHAT_ID = os.getenv("TELEGRAM_ADMIN_CHAT_ID", "98172645")

# Configuración de Tolerancia e Intervalos (Minutos)
TOLERANCIA_MINUTOS = int(os.getenv("TOLERANCIA_MINUTOS", "60"))
FRECUENCIA_AVISOS_MINUTOS = int(os.getenv("FRECUENCIA_AVISOS_MINUTOS", "45"))
MAX_REINTENTOS_ALERTA = int(os.getenv("MAX_REINTENTOS_ALERTA", "3"))
HORA_REPORTE_METAS_DIARIAS = os.getenv("HORA_REPORTE_METAS_DIARIAS", "19:00")

# Scraper Headless
SCRAPER_INTERVALO_MINUTOS = int(os.getenv("SCRAPER_INTERVALO_MINUTOS", "5"))
SCRAPER_HEADLESS_STRICT = os.getenv("SCRAPER_HEADLESS_STRICT", "true").lower() == "true"
SCRAPER_TIMEOUT_SEGUNDOS = int(os.getenv("SCRAPER_TIMEOUT_SEGUNDOS", "15"))

# Almacenamiento Temporal de Videos y Política de Eliminación en Drive
TEMP_VIDEO_DIR = BASE_DIR / "temp_videos"
TEMP_VIDEO_DIR.mkdir(parents=True, exist_ok=True)

# Política de Eliminación en Google Drive tras confirmación exitosa
DRIVE_AUTO_DELETE = os.getenv("DRIVE_AUTO_DELETE", "true").lower() == "true"
DRIVE_RETENTION_HOURS = int(os.getenv("DRIVE_RETENTION_HOURS", "24")) # Horas de espera tras confirmación y aviso

# Google Gemini IA para Generación de Copys y Descripciones
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
