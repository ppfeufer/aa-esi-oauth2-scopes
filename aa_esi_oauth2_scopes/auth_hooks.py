"""Hook into Alliance Auth"""

# Django
from django.utils.translation import gettext_lazy as _

# Alliance Auth
from allianceauth import hooks
from allianceauth.services.hooks import MenuItemHook, UrlHook

# AA ESI OAuth2 Scopes
from aa_esi_oauth2_scopes import urls


class AAESIOAuth2ScopesMenuItem(MenuItemHook):
    """This class ensures only authorized users will see the menu entry"""

    def __init__(self):
        # setup menu entry for sidebar
        MenuItemHook.__init__(
            self,
            _("ESI OAuth2 Scopes"),
            "fas fa-cube fa-fw",
            "aa_esi_oauth2_scopes:index",
            navactive=["aa_esi_oauth2_scopes:"],
        )

    def render(self, request):
        """Render the menu item"""

        return MenuItemHook.render(self, request)


@hooks.register("menu_item_hook")
def register_menu():
    """Register the menu item"""

    return AAESIOAuth2ScopesMenuItem()


@hooks.register("url_hook")
def register_urls():
    """Register app urls"""

    return UrlHook(urls, "aa_esi_oauth2_scopes", r"^esi-oauth2-scopes/")
