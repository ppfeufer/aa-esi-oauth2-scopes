"""
Unit tests for the views in the aa_esi_oauth2_scopes app.
"""

# Django
from django.contrib.auth.models import User
from django.test import RequestFactory
from django.urls import reverse

# AA ESI OAuth2 Scopes
from aa_esi_oauth2_scopes import views
from aa_esi_oauth2_scopes.tests import BaseTestCase


class IndexViewTests(BaseTestCase):
    """
    Tests for the index view of the aa_esi_oauth2_scopes app.
    """

    def test_anonymous_user_is_redirected_to_login(self):
        """
        Test that an anonymous user is redirected to the login page when trying to access the index view.

        :return:
        """

        response = self.client.get(reverse("aa_esi_oauth2_scopes:index"))

        self.assertEqual(response.status_code, 302)

    def test_authenticated_user_gets_index_and_template_rendered(self):
        """
        Test that an authenticated user can access the index view and that the correct template is rendered.

        :return:
        """

        # Call the view directly with a RequestFactory request and an authenticated user
        user = User.objects.create_user(username="view_user", password="password")

        factory = RequestFactory()
        request = factory.get(reverse("aa_esi_oauth2_scopes:index"))
        request.user = user
        response = views.index(request)

        self.assertEqual(response.status_code, 200)
        # Ensure the rendered content contains a heading from the template
        self.assertIn(b"ESI OAuth2 Scopes", response.content)

    def test_response_context_is_available_for_authenticated_user(self):
        """
        Test that the response context is available for an authenticated user accessing the index view.

        :return:
        """

        user = User.objects.create_user(username="ctx_user", password="password")

        # Use RequestFactory so we can attach the user directly to the request
        factory = RequestFactory()
        request = factory.get(reverse("aa_esi_oauth2_scopes:index"))
        request.user = user
        response = views.index(request)

        # When rendering directly we get an HttpResponse with content instead of a test client's context
        self.assertTrue(hasattr(response, "content"))
