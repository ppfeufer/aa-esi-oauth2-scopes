"""App URLs"""

# Django
from django.urls import path

# AA ESI OAuth2 Scopes
from aa_esi_oauth2_scopes import views

app_name: str = "aa_esi_oauth2_scopes"  # pylint: disable=invalid-name

urlpatterns = [
    path("", views.index, name="index"),
]
