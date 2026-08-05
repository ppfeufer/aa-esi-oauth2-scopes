"""App Configuration"""

# Django
from django.apps import AppConfig

# AA ESI OAuth2 Scopes
# AA ESI OAuth2 Scopes App
from aa_esi_oauth2_scopes import __version__


class AAESIOAuth2ScopesConfig(AppConfig):
    """App Config"""

    name = "aa_esi_oauth2_scopes"
    label = "aa_esi_oauth2_scopes"
    verbose_name = f"AA ESI OAuth2 Scopes App v{__version__}"
