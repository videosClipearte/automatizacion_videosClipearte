# backend/scraper/silent_scraper.py
"""
Implementación 3: Scraper Silencioso de Verificación y Métricas (Headless Python)
- 100% en segundo plano: NUNCA abre navegadores visibles ni ventanas de interfaz gráfica.
- Verifica si un post programado ya está en vivo en Instagram, TikTok, Facebook o YouTube.
- Extrae métricas reales (vistas, likes, comentarios) y las guarda en la tabla Supabase.
- VERIFICACIÓN ESTRICTA: Solo marca como PUBLICADO si hay coincidencia real (≥2 tokens clave)
  entre la descripción aprobada y el HTML del perfil/post scrapeado.
"""
import re
import json
import logging
import requests
from typing import Dict, Any, Optional, List
from datetime import datetime

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("SilentScraper")


def _extract_keywords(text: str, min_len: int = 4) -> List[str]:
    """
    Extrae palabras clave significativas de un texto, ignorando stopwords comunes
    y priorizando hashtags. Retorna lista en lowercase.
    """
    if not text:
        return []
    # Incluir hashtags y palabras largas; excluir stopwords básicas
    stopwords = {
        "para", "este", "esta", "esto", "como", "que", "los", "las", "del",
        "con", "una", "uno", "por", "son", "sus", "pero", "todo", "cada",
        "nuestro", "nuestra", "sobre", "entre", "desde", "hasta", "tiene",
        "the", "and", "for", "are", "with", "this", "that", "from", "your",
    }
    tokens = []
    for word in re.split(r'\s+', text):
        clean = word.strip(".,!?:;\"'()[]{}").lower()
        if clean.startswith("#"):
            tokens.append(clean)  # siempre incluir hashtags
        elif len(clean) >= min_len and clean not in stopwords:
            tokens.append(clean)
    return tokens


class SilentScraper:
    # Umbral mínimo de tokens coincidentes para confirmar publicación
    MIN_MATCH_THRESHOLD = 2

    def __init__(self, timeout: int = 15):
        self.timeout = timeout
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        }

    def verify_post_live(
        self,
        platform: str,
        profile_url: str,
        expected_title: str,
        post_url: Optional[str] = None,
        expected_description: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Verificación silenciosa en segundo plano (sin abrir navegador web).
        
        LÓGICA DE VERIFICACIÓN ESTRICTA:
        - Extrae tokens clave de la descripción aprobada (descripcion_aprobada_ia).
        - Requiere que al menos MIN_MATCH_THRESHOLD tokens aparezcan en el HTML del post/perfil.
        - Si no se pueden verificar suficientes tokens → is_live = False (no marca como publicado).
        - Solo retorna is_live = True cuando hay evidencia real de publicación.
        """
        logger.info(f"Ejecutando verificación silenciosa para {platform} ({profile_url}) - Video: '{expected_title}'")

        # ── 1. Construir lista de tokens a buscar ──────────────────────────────
        keywords: List[str] = []

        if expected_description:
            keywords = _extract_keywords(expected_description)
            logger.info(f"Tokens extraídos de la descripción aprobada ({len(keywords)}): {keywords[:10]}")
        
        if not keywords and expected_title:
            keywords = _extract_keywords(expected_title, min_len=3)
            logger.info(f"Usando tokens del título como fallback ({len(keywords)}): {keywords}")

        if not keywords:
            logger.warning("No hay tokens disponibles para verificar. Se requiere description o title.")
            return {
                "is_live": False,
                "description_matched": False,
                "error": "No hay tokens de verificación disponibles (descripcion_aprobada_ia o titulo vacíos).",
                "checked_at": datetime.utcnow().isoformat(),
            }

        # ── 2. Intentar verificar por URL directa del post (más precisa) ──────
        if post_url and post_url not in ("#", "", None):
            result = self._check_url(post_url, keywords, method="direct_post_url")
            if result is not None:
                return result

        # ── 3. Fallback: verificar desde el perfil público ────────────────────
        if profile_url:
            target_url = (
                profile_url
                if profile_url.startswith("http")
                else f"https://{platform.lower()}.com/{profile_url.replace('@', '')}"
            )
            result = self._check_url(target_url, keywords, method="profile_http_check")
            if result is not None:
                return result

        # ── 4. No se pudo verificar ───────────────────────────────────────────
        return {
            "is_live": False,
            "description_matched": False,
            "error": "No se pudo acceder al post o perfil para verificar la publicación.",
            "checked_at": datetime.utcnow().isoformat(),
        }

    def _check_url(self, url: str, keywords: List[str], method: str) -> Optional[Dict[str, Any]]:
        """
        Realiza un GET silencioso a una URL y comprueba la coincidencia de keywords
        en el HTML de respuesta. Retorna None si la petición falla (para que el
        llamante pruebe la siguiente URL).
        """
        try:
            resp = requests.get(url, headers=self.headers, timeout=self.timeout)
        except Exception as e:
            logger.warning(f"[{method}] Consulta HTTP a {url} falló: {e}")
            return None

        if resp.status_code != 200:
            logger.warning(f"[{method}] {url} respondió HTTP {resp.status_code} — no se puede verificar.")
            return {
                "is_live": False,
                "description_matched": False,
                "status_code": resp.status_code,
                "error": f"HTTP {resp.status_code} al consultar {url}",
                "checked_at": datetime.utcnow().isoformat(),
            }

        html_lower = resp.text.lower()
        matched = [kw for kw in keywords if kw in html_lower]
        match_count = len(matched)

        # ── UMBRAL ESTRICTO: necesita al menos MIN_MATCH_THRESHOLD coincidencias ──
        is_confirmed = match_count >= self.MIN_MATCH_THRESHOLD
        match_pct = round((match_count / max(len(keywords), 1)) * 100, 1)

        logger.info(
            f"[{method}] URL: {url} | "
            f"Coincidencias: {match_count}/{len(keywords)} ({match_pct}%) | "
            f"Tokens: {matched[:6]} | "
            f"Confirmado: {is_confirmed}"
        )

        return {
            "is_live": is_confirmed,
            "description_matched": is_confirmed,
            "matched_tokens": matched,
            "match_count": match_count,
            "total_keywords": len(keywords),
            "match_percentage": match_pct,
            "status_code": 200,
            "post_url": url,
            "method": method,
            "checked_at": datetime.utcnow().isoformat(),
        }

    def extract_metrics(self, platform: str, post_url: str) -> Dict[str, Any]:
        """
        Extracción silenciosa de métricas (views, likes, comentarios) en segundo plano.
        """
        logger.info(f"Extrayendo métricas silenciosas para {platform} en {post_url}")

        try:
            if post_url and post_url.startswith("http"):
                resp = requests.get(post_url, headers=self.headers, timeout=self.timeout)
                if resp.status_code == 200:
                    text = resp.text

                    # Regex para extraer conteo de vistas o likes de meta tags
                    views_match = re.search(r'(\d+[\d,.]*)[\s\xa0]*(?:views|reproducciones|vistas)', text, re.IGNORECASE)
                    likes_match = re.search(r'(\d+[\d,.]*)[\s\xa0]*(?:likes|me\s+gusta)', text, re.IGNORECASE)
                    comments_match = re.search(r'(\d+[\d,.]*)[\s\xa0]*(?:comments?|comentarios?)', text, re.IGNORECASE)

                    views = int(views_match.group(1).replace(",", "").replace(".", "")) if views_match else None
                    likes = int(likes_match.group(1).replace(",", "").replace(".", "")) if likes_match else None
                    comments = int(comments_match.group(1).replace(",", "").replace(".", "")) if comments_match else None

                    if views is not None or likes is not None:
                        return {
                            "success": True,
                            "vistas": views or 0,
                            "likes": likes or 0,
                            "comentarios": comments or 0,
                            "source": "scraper_real",
                            "extracted_at": datetime.utcnow().isoformat(),
                        }
        except Exception as e:
            logger.warning(f"Extracción directa falló: {e}")

        # Valores base estimados (cuando no se pueden extraer métricas reales)
        logger.info("No se encontraron métricas reales en el HTML. Retornando estado sin métricas.")
        return {
            "success": False,
            "vistas": None,
            "likes": None,
            "comentarios": None,
            "source": "unavailable",
            "error": "No se pudieron extraer métricas reales del HTML público.",
            "extracted_at": datetime.utcnow().isoformat(),
        }
