# backend/youtube/token_manager.py
"""
Gestor de Tokens OAuth2 por Canal de YouTube.
- Lee client_id y client_secret desde Supabase (tabla configuracion_app),
  igual que el resto de la app. NO necesita archivo client_secret.json.
- Guarda tokens individuales por canal en disco: tokens/token_<canal_id>.json
- Refresca automaticamente el access_token cuando expira usando el refresh_token.
"""
import os
import json
import logging
from pathlib import Path
from typing import Optional, Dict, Any
from datetime import datetime

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow

logger = logging.getLogger("YouTubeTokenManager")

# Permisos requeridos para subir videos a YouTube
SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube",
]

# Directorio donde se guardan los tokens por canal
TOKENS_DIR = Path(__file__).parent / "tokens"
TOKENS_DIR.mkdir(parents=True, exist_ok=True)

# URL base de la API de token de Google
GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token"


def _load_yt_credentials_from_supabase() -> Dict[str, str]:
    """
    Carga youtube_client_id y youtube_client_secret desde Supabase
    (tabla configuracion_app, fila singleton), igual que el resto de la app.
    """
    try:
        import sys
        sys.path.insert(0, str(Path(__file__).parent.parent))
        from config import SUPABASE_URL, SUPABASE_KEY
        import requests as req

        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
        }
        # Intentar obtener la fila singleton primero
        resp = req.get(
            f"{SUPABASE_URL}/rest/v1/configuracion_app?id=eq.singleton&select=youtube_client_id,youtube_client_secret",
            headers=headers,
            timeout=10,
        )
        data = resp.json()
        if data and isinstance(data, list) and len(data) > 0:
            row = data[0]
            if row.get("youtube_client_id") and row.get("youtube_client_secret"):
                logger.info("Credenciales YouTube cargadas desde Supabase (singleton).")
                return {
                    "client_id": row["youtube_client_id"],
                    "client_secret": row["youtube_client_secret"],
                }

        # Fallback: primera fila de la tabla
        resp2 = req.get(
            f"{SUPABASE_URL}/rest/v1/configuracion_app?select=youtube_client_id,youtube_client_secret&limit=1",
            headers=headers,
            timeout=10,
        )
        data2 = resp2.json()
        if data2 and isinstance(data2, list) and len(data2) > 0:
            row2 = data2[0]
            if row2.get("youtube_client_id") and row2.get("youtube_client_secret"):
                logger.info("Credenciales YouTube cargadas desde Supabase (primera fila).")
                return {
                    "client_id": row2["youtube_client_id"],
                    "client_secret": row2["youtube_client_secret"],
                }

    except Exception as e:
        logger.warning(f"No se pudieron cargar credenciales YouTube desde Supabase: {e}")

    # Fallback final: variables de entorno
    client_id = os.getenv("YOUTUBE_CLIENT_ID", "")
    client_secret = os.getenv("YOUTUBE_CLIENT_SECRET", "")
    if client_id and client_secret:
        logger.info("Credenciales YouTube cargadas desde variables de entorno.")
        return {"client_id": client_id, "client_secret": client_secret}

    logger.error(
        "No se encontraron youtube_client_id / youtube_client_secret. "
        "Agregalos en Supabase (tabla configuracion_app) o en el .env del backend."
    )
    return {}


class TokenManager:
    """
    Administra los tokens OAuth2 de multiples canales de YouTube.
    Cada canal tiene su propio archivo: tokens/token_<canal_id>.json
    Las credenciales OAuth (client_id / client_secret) se leen de Supabase.
    """

    def __init__(self):
        # Cargar credenciales desde Supabase al inicializar
        self._creds_source = _load_yt_credentials_from_supabase()
        self.client_id = self._creds_source.get("client_id", "")
        self.client_secret = self._creds_source.get("client_secret", "")

        if not self.client_id or not self.client_secret:
            logger.warning(
                "TokenManager: youtube_client_id o youtube_client_secret estan vacios. "
                "Configuralos en Supabase -> configuracion_app."
            )

    def _token_path(self, canal_id: str) -> Path:
        """Retorna la ruta del archivo de token para un canal especifico."""
        safe_id = canal_id.replace("@", "").replace(" ", "_").lower()
        return TOKENS_DIR / f"token_{safe_id}.json"

    def _build_client_config(self) -> Dict[str, Any]:
        """Construye la config de cliente OAuth en el formato que espera google-auth-oauthlib."""
        return {
            "installed": {
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": GOOGLE_TOKEN_URI,
                "redirect_uris": ["urn:ietf:wg:oauth:2.0:oob", "http://localhost"],
            }
        }

    def _load_token_from_supabase(self, canal_id: str) -> Optional[Dict[str, Any]]:
        """Intenta descargar el token del canal desde la tabla youtube_tokens de Supabase."""
        try:
            from config import SUPABASE_URL, SUPABASE_KEY
            import requests as req
            safe_id = canal_id.replace("@", "").replace(" ", "_").lower()
            headers = {
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": "application/json",
            }
            resp = req.get(
                f"{SUPABASE_URL}/rest/v1/youtube_tokens?canal_id=eq.{safe_id}&select=*",
                headers=headers,
                timeout=10,
            )
            data = resp.json()
            if data and isinstance(data, list) and len(data) > 0:
                row = data[0]
                token_data = {
                    "token": row.get("access_token", ""),
                    "refresh_token": row.get("refresh_token", ""),
                    "token_uri": row.get("token_uri", "https://oauth2.googleapis.com/token"),
                    "scopes": row.get("scopes", "https://www.googleapis.com/auth/youtube.upload").split(),
                    "canal_id": safe_id,
                }
                if token_data.get("token") or token_data.get("refresh_token"):
                    logger.info(f"[{canal_id}] Token descargado exitosamente desde tabla youtube_tokens.")
                    return token_data
        except Exception as e:
            logger.debug(f"[{canal_id}] No se pudo consultar token en Supabase: {e}")
        return None

    def get_credentials(self, canal_id: str) -> Optional[Credentials]:
        """
        Obtiene credenciales validas para un canal.
        - Si existe token guardado y es valido -> lo retorna directamente.
        - Si no está en disco local, intenta descargarlo desde Supabase.
        - Si el access_token expiro pero hay refresh_token -> lo renueva automaticamente.
        - Si no hay token -> retorna None (necesita autorizacion inicial).
        """
        token_path = self._token_path(canal_id)

        token_data = None
        if token_path.exists():
            try:
                with open(token_path, "r", encoding="utf-8") as f:
                    token_data = json.load(f)
            except Exception as e:
                logger.error(f"[{canal_id}] Error leyendo token local: {e}")

        # Si no existe en disco, verificar en Supabase
        if not token_data:
            token_data = self._load_token_from_supabase(canal_id)
            if token_data:
                # Guardar en disco local para cache
                try:
                    with open(token_path, "w", encoding="utf-8") as f:
                        json.dump(token_data, f, indent=2, ensure_ascii=False)
                except Exception:
                    pass

        if not token_data:
            logger.info(f"[{canal_id}] No hay token guardado. Se requiere autorizacion inicial.")
            return None

        try:

            creds = Credentials(
                token=token_data.get("token"),
                refresh_token=token_data.get("refresh_token"),
                token_uri=GOOGLE_TOKEN_URI,
                client_id=self.client_id or token_data.get("client_id"),
                client_secret=self.client_secret or token_data.get("client_secret"),
                scopes=token_data.get("scopes", SCOPES),
            )

            # Si el token expiro, refrescarlo automaticamente con el refresh_token
            if creds.expired and creds.refresh_token:
                logger.info(f"[{canal_id}] Access token expirado. Refrescando automaticamente...")
                creds.refresh(Request())
                self._save_credentials(canal_id, creds)
                logger.info(f"[{canal_id}] Token refrescado y guardado.")

            return creds

        except Exception as e:
            logger.error(f"[{canal_id}] Error al cargar credenciales: {e}")
            return None

    def _save_credentials(self, canal_id: str, creds: Credentials) -> None:
        """Guarda las credenciales actualizadas en disco."""
        token_path = self._token_path(canal_id)
        token_data = {
            "token": creds.token,
            "refresh_token": creds.refresh_token,
            "token_uri": GOOGLE_TOKEN_URI,
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "scopes": list(creds.scopes) if creds.scopes else SCOPES,
            "saved_at": datetime.utcnow().isoformat(),
            "canal_id": canal_id,
        }
        with open(token_path, "w", encoding="utf-8") as f:
            json.dump(token_data, f, indent=2, ensure_ascii=False)
        logger.info(f"[{canal_id}] Token guardado en {token_path}")

    def authorize_channel(self, canal_id: str) -> Optional[Credentials]:
        """
        Ejecuta el flujo de autorizacion OAuth2 para un canal.
        Abre el browser para que el usuario inicie sesion con su cuenta de Google.
        Solo se llama UNA VEZ por canal. El token se guarda y renueva solo despues.
        """
        if not self.client_id or not self.client_secret:
            logger.error(
                "No hay client_id o client_secret disponibles. "
                "Configura youtube_client_id y youtube_client_secret en Supabase."
            )
            return None

        logger.info(f"[{canal_id}] Iniciando flujo de autorizacion OAuth2 (credenciales desde Supabase)...")

        try:
            flow = InstalledAppFlow.from_client_config(
                self._build_client_config(),
                scopes=SCOPES,
            )
            creds = flow.run_local_server(
                port=0,
                prompt="select_account",  # Fuerza seleccion de cuenta
                success_message=f"Canal '{canal_id}' autorizado. Puedes cerrar esta ventana.",
            )
            self._save_credentials(canal_id, creds)
            logger.info(f"[{canal_id}] Autorizacion completada. Token: {self._token_path(canal_id)}")
            return creds

        except Exception as e:
            logger.error(f"[{canal_id}] Error durante la autorizacion: {e}")
            return None

    def list_authorized_channels(self) -> list:
        """Lista todos los canales que ya tienen token autorizado."""
        channels = []
        for token_file in TOKENS_DIR.glob("token_*.json"):
            try:
                with open(token_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                channels.append({
                    "canal_id": data.get("canal_id", token_file.stem.replace("token_", "")),
                    "archivo": token_file.name,
                    "guardado_en": data.get("saved_at", "desconocido"),
                    "tiene_refresh_token": bool(data.get("refresh_token")),
                })
            except Exception:
                pass
        return channels

    def revoke_channel(self, canal_id: str) -> bool:
        """Elimina el token de un canal (desautoriza)."""
        token_path = self._token_path(canal_id)
        if token_path.exists():
            token_path.unlink()
            logger.info(f"[{canal_id}] Token eliminado.")
            return True
        return False
