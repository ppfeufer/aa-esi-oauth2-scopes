"""App Configuration"""

# Django
from django.apps import AppConfig

# AA ESI OAuth2 Scopes
from aa_esi_oauth2_scopes import __version__


class AAESIOAuth2ScopesConfig(AppConfig):
    """
    App configuration for the AA ESI OAuth2 Scopes app
    """

    name = "aa_esi_oauth2_scopes"
    label = "aa_esi_oauth2_scopes"
    verbose_name = f"AA ESI OAuth2 Scopes App v{__version__}"
