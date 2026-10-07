# backend/youtube/authorize.py
"""
Script de Autorizacion OAuth2 por Canal de YouTube.
Uso:
    python youtube/authorize.py --channel=canal_gaming
    python youtube/authorize.py --channel=cuenta2
    python youtube/authorize.py --list
    python youtube/authorize.py --info --channel=canal_gaming

Ejecutar UNA SOLA VEZ por canal. Despues el sistema renueva el token automaticamente.
"""
import sys
import argparse
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("YouTubeAuthorize")

# Agregar el directorio backend al path para importar modulos
sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent.parent))

from youtube.token_manager import TokenManager
from youtube.youtube_publisher import YouTubePublisher


def main():
    parser = argparse.ArgumentParser(
        description="Gestor de autorizacion OAuth2 para canales de YouTube"
    )
    parser.add_argument("--channel", type=str, help="ID/nombre del canal a autorizar (ej: canal_gaming)")
    parser.add_argument("--list", action="store_true", help="Lista todos los canales autorizados")
    parser.add_argument("--info", action="store_true", help="Muestra info del canal desde YouTube API")
    parser.add_argument("--revoke", action="store_true", help="Elimina el token del canal (desautoriza)")

    args = parser.parse_args()
    token_manager = TokenManager()

    # -- Listar canales autorizados ------------------------------------------
    if args.list:
        channels = token_manager.list_authorized_channels()
        if not channels:
            print("\n??  No hay canales autorizados todavia.")
            print("Ejecuta: python youtube/authorize.py --channel=<nombre_canal>\n")
        else:
            print(f"\n? Canales autorizados ({len(channels)}):")
            print("-" * 50)
            for ch in channels:
                refresh_ok = "? refresh_token OK" if ch["tiene_refresh_token"] else "??  sin refresh_token"
                print(f"  ?? {ch['canal_id']}")
                print(f"     Archivo: {ch['archivo']}")
                print(f"     Guardado: {ch['guardado_en']}")
                print(f"     Estado:   {refresh_ok}")
                print()
        return

    # -- Validar que se especifico un canal ---------------------------------
    if not args.channel:
        parser.print_help()
        print("\n? Error: Debes especificar --channel=<nombre_canal>")
        print("   Ejemplo: python youtube/authorize.py --channel=canal_gaming\n")
        sys.exit(1)

    canal_id = args.channel

    # -- Revocar token ------------------------------------------------------
    if args.revoke:
        success = token_manager.revoke_channel(canal_id)
        if success:
            print(f"? Token del canal '{canal_id}' eliminado exitosamente.")
        else:
            print(f"??  No se encontro token para el canal '{canal_id}'.")
        return

    # -- Mostrar info del canal ---------------------------------------------
    if args.info:
        publisher = YouTubePublisher(token_manager)
        info = publisher.get_channel_info(canal_id)
        if info.get("success"):
            print(f"\n?? Informacion del canal '{canal_id}':")
            print("-" * 50)
            print(f"  Nombre YouTube:  {info['nombre']}")
            print(f"  Channel ID:      {info['youtube_channel_id']}")
            print(f"  Suscriptores:    {int(info['suscriptores']):,}")
            print(f"  Videos totales:  {info['videos_totales']}")
            print(f"  Vistas totales:  {int(info['vistas_totales']):,}\n")
        else:
            print(f"? Error: {info.get('error')}")
            print("Verifica que el canal este autorizado con: python youtube/authorize.py --list")
        return

    # -- Flujo de autorizacion OAuth2 ---------------------------------------
    existing = token_manager.get_credentials(canal_id)
    if existing and not existing.expired:
        print(f"\n? El canal '{canal_id}' ya esta autorizado y su token es valido.")
        print("   Si quieres re-autorizarlo, primero revocalo:")
        print(f"   python youtube/authorize.py --revoke --channel={canal_id}\n")
        return

    print(f"\n?? Autorizando canal: '{canal_id}'")
    print("-" * 50)
    print("1. Se abrira tu navegador automaticamente.")
    print("2. Inicia sesion con la cuenta de Google del canal.")
    print("3. Haz click en 'Permitir' cuando Google te lo pida.")
    print("4. El token se guardara automaticamente.\n")

    creds = token_manager.authorize_channel(canal_id)
    if creds:
        print(f"\n? Canal '{canal_id}' autorizado exitosamente.")
        print(f"   Token guardado en: youtube/tokens/token_{canal_id.lower()}.json")
        print(f"   El sistema renovara el token automaticamente cuando expire.\n")

        # Verificar con info del canal
        publisher = YouTubePublisher(token_manager)
        info = publisher.get_channel_info(canal_id)
        if info.get("success"):
            print(f"   ?? Canal verificado: {info['nombre']}")
            print(f"   ?? Suscriptores: {int(info['suscriptores']):,}\n")
    else:
        print(f"\n? Error al autorizar el canal '{canal_id}'.")
        print("   Verifica que client_secret.json existe en backend/youtube/\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
