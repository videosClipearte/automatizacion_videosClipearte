# backend/youtube/youtube_publisher.py
"""
Publicador de Videos/Shorts en YouTube via YouTube Data API v3.
- Sube videos a YouTube usando las credenciales OAuth2 por canal.
- Detecta automáticamente si es un Short (duracion <= 60s o flag explicit).
- Incluye titulo, descripcion, tags, categoria, privacidad y miniatura.
- Retorna la URL del video publicado y su ID de YouTube.
"""
import os
import logging
import time
from pathlib import Path
from typing import Optional, Dict, Any

from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from googleapiclient.errors import HttpError

from youtube.token_manager import TokenManager

logger = logging.getLogger("YouTubePublisher")

# Categoria por defecto: 22 = People & Blogs, 24 = Entertainment, 28 = Science & Technology
DEFAULT_CATEGORY_ID = "22"


class YouTubePublisher:
    """
    Sube videos/Shorts a YouTube usando la API oficial.
    Soporta multiples canales con tokens independientes.
    """

    def __init__(self, token_manager: Optional[TokenManager] = None):
        self.token_manager = token_manager or TokenManager()

    def _build_service(self, canal_id: str):
        """Construye el cliente de YouTube API autenticado para el canal dado."""
        creds = self.token_manager.get_credentials(canal_id)
        if not creds:
            raise ValueError(
                f"Canal '{canal_id}' no tiene token autorizado. "
                f"Ejecuta: python authorize.py --channel={canal_id}"
            )
        return build("youtube", "v3", credentials=creds)

    def upload_short(
        self,
        canal_id: str,
        video_path: str,
        titulo: str,
        descripcion: str,
        tags: Optional[list] = None,
        categoria_id: str = DEFAULT_CATEGORY_ID,
        privacidad: str = "public",
        miniatura_path: Optional[str] = None,
        made_for_kids: bool = False,
    ) -> Dict[str, Any]:
        """
        Sube un video como YouTube Short.

        Args:
            canal_id:        Identificador del canal (ej: "canal_gaming", "cuenta1")
            video_path:      Ruta local del archivo de video (.mp4)
            titulo:          Titulo del Short (max 100 chars)
            descripcion:     Descripcion con hashtags (incluye #Shorts para clasificarlo)
            tags:            Lista de tags/keywords
            categoria_id:    ID de categoria de YouTube
            privacidad:      "public", "private" o "unlisted"
            miniatura_path:  Ruta de imagen de miniatura (opcional)
            made_for_kids:   True si el contenido es para ninos

        Returns:
            Dict con: success, video_id, video_url, error (si falla)
        """
        video_path = Path(video_path)
        if not video_path.exists():
            return {
                "success": False,
                "error": f"Archivo de video no encontrado: {video_path}",
                "canal_id": canal_id,
            }

        # Asegurar que #Shorts esta en la descripcion para que YouTube lo clasifique
        if "#Shorts" not in descripcion and "#shorts" not in descripcion:
            descripcion = f"{descripcion}\n\n#Shorts"

        # Truncar titulo a 100 caracteres (limite de YouTube)
        titulo_final = titulo[:100] if len(titulo) > 100 else titulo

        # Tags por defecto + los del usuario
        tags_finales = (tags or []) + ["Shorts", "Short"]

        body = {
            "snippet": {
                "title": titulo_final,
                "description": descripcion,
                "tags": tags_finales,
                "categoryId": categoria_id,
                "defaultLanguage": "es",
            },
            "status": {
                "privacyStatus": privacidad,
                "selfDeclaredMadeForKids": made_for_kids,
            },
        }

        media = MediaFileUpload(
            str(video_path),
            mimetype="video/*",
            resumable=True,
            chunksize=1024 * 1024 * 5,  # Chunks de 5MB
        )

        logger.info(f"[{canal_id}] Iniciando subida de Short: '{titulo_final}' ({video_path.name})")

        try:
            service = self._build_service(canal_id)
            request = service.videos().insert(
                part="snippet,status",
                body=body,
                media_body=media,
            )

            # Subida con reintentos por chunks (resumable upload)
            response = None
            retry_count = 0
            max_retries = 5

            while response is None:
                try:
                    status, response = request.next_chunk()
                    if status:
                        progress = int(status.progress() * 100)
                        logger.info(f"[{canal_id}] Progreso de subida: {progress}%")
                except HttpError as e:
                    if e.resp.status in [500, 502, 503, 504] and retry_count < max_retries:
                        retry_count += 1
                        wait = 2 ** retry_count
                        logger.warning(f"[{canal_id}] Error HTTP {e.resp.status}. Reintento {retry_count}/{max_retries} en {wait}s...")
                        time.sleep(wait)
                    else:
                        raise

            video_id = response.get("id")
            video_url = f"https://www.youtube.com/shorts/{video_id}"

            logger.info(f"[{canal_id}] ? Short publicado exitosamente: {video_url}")

            # Subir miniatura si se proporciono
            if miniatura_path and Path(miniatura_path).exists():
                self._upload_thumbnail(service, canal_id, video_id, miniatura_path)

            return {
                "success": True,
                "canal_id": canal_id,
                "video_id": video_id,
                "video_url": video_url,
                "titulo": titulo_final,
                "privacidad": privacidad,
            }

        except HttpError as e:
            error_msg = f"YouTube API Error {e.resp.status}: {e.content.decode('utf-8', errors='ignore')}"
            logger.error(f"[{canal_id}] {error_msg}")
            return {
                "success": False,
                "canal_id": canal_id,
                "error": error_msg,
            }
        except Exception as e:
            logger.error(f"[{canal_id}] Error inesperado al subir video: {e}")
            return {
                "success": False,
                "canal_id": canal_id,
                "error": str(e),
            }

    def _upload_thumbnail(self, service, canal_id: str, video_id: str, thumbnail_path: str) -> bool:
        """Sube una miniatura personalizada al video."""
        try:
            media = MediaFileUpload(thumbnail_path, mimetype="image/jpeg")
            service.thumbnails().set(videoId=video_id, media_body=media).execute()
            logger.info(f"[{canal_id}] Miniatura subida para video {video_id}")
            return True
        except Exception as e:
            logger.warning(f"[{canal_id}] No se pudo subir miniatura: {e}")
            return False

    def get_channel_info(self, canal_id: str) -> Dict[str, Any]:
        """Obtiene info del canal (nombre, suscriptores, id de YouTube)."""
        try:
            service = self._build_service(canal_id)
            response = service.channels().list(part="snippet,statistics", mine=True).execute()
            items = response.get("items", [])
            if items:
                item = items[0]
                return {
                    "success": True,
                    "canal_id": canal_id,
                    "youtube_channel_id": item["id"],
                    "nombre": item["snippet"]["title"],
                    "descripcion": item["snippet"].get("description", ""),
                    "suscriptores": item["statistics"].get("subscriberCount", 0),
                    "videos_totales": item["statistics"].get("videoCount", 0),
                    "vistas_totales": item["statistics"].get("viewCount", 0),
                }
            return {"success": False, "error": "No se encontro informacion del canal."}
        except Exception as e:
            return {"success": False, "canal_id": canal_id, "error": str(e)}
