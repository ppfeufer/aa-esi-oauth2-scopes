/* global aa_esi_oauth2_scopes_translations */

$(document).ready(() => {
    'use strict';

    const OPENAPI_URL = 'https://esi.evetech.net/meta/openapi.json';
    const COMPAT_DATES_URL = 'https://esi.evetech.net/meta/compatibility-dates';
    const EXPLORER_URL = 'https://developers.eveonline.com/api-explorer#/operations/';
    const CACHE_PREFIX = 'esiScopesOpenApiCache.v2.';

    /**
     * Compute the TTL for the cache in milliseconds until the next occurrence of 11:30 UTC.
     *
     * @type {number}
     */
    const CACHE_TTL_MS = (() => {
        const now = new Date();
        // Construct today's 11:30 UTC
        const next1130 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 11, 30, 0, 0));

        if (now.getTime() >= next1130.getTime()) {
            // If it's already past today's 11:30 UTC, use tomorrow's
            next1130.setUTCDate(next1130.getUTCDate() + 1);
        }

        const ttl = next1130.getTime() - now.getTime();

        // Fallback to 12 hours if computation fails for any reason
        return ttl > 0 ? ttl : 12 * 60 * 60 * 1000;
    })();

    const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch'];
    const METHOD_LABEL_CLASS = {
        get: 'text-bg-secondary',
        post: 'text-bg-success',
        put: 'text-bg-warning',
        delete: 'text-bg-danger',
        patch: 'text-bg-info'
    };

    let currentScopes = null; // Built from the spec currently on screen, re-filtered on every keystroke

    /**
     * Escape HTML special characters in a string to prevent XSS.
     *
     * @param {string} s - The string to escape.
     * @returns {*|jQuery} - The escaped string as HTML.
     */
    const escapeHtml = (s) => {
        return $('<div>').text(s === null ? '' : s).html();
    };

    /**
     * Format a template string with named placeholders using the provided values.
     *
     * @param {string|Object} template - The template string or object containing plural forms.
     * @param {Object} values - An object containing the values to replace in the template.
     * @returns {string} - The formatted string.
     */
    const formatTemplateTranslation = (template, values = {}) => {
        /**
         * Render a template string by replacing placeholders with corresponding values.
         *
         * @param {string} tpl - The template string to render.
         * @returns {string} - The rendered string.
         */
        const render = (tpl) => {
            return String(tpl).replace(
                /%\(([^)]+)\)s/g,
                (_, key) => String(values[key] ?? '')
            );
        };

        if (template && typeof template === 'object') {
            // Support object/array plural forms:
            // { singular: '...', plural: '...' } or ['singular', 'plural']
            const count = Number(values.count ?? values.number ?? 0);
            const singular = Array.isArray(template) ? template[0] : (template.singular ?? template.singular);
            const plural = Array.isArray(template) ? template[1] : (template.plural ?? template.plural);
            const chosen = (count === 1 ? singular : plural) ?? singular ?? plural ?? '';

            return render(chosen);
        }

        return render(template);
    };

    /**
     * Build a mapping of OAuth2 scopes to their associated endpoints from the OpenAPI specification.
     *
     * Builds scope -> [endpoint, ...] from the OpenAPI document.
     * Every operation in ESI's spec requires at most one OAuth2 scope (never an AND of several),
     * so a single security entry per operation is enough.
     *
     * @param {Object} spec - The OpenAPI specification object.
     * @returns {Array} - An array of scope objects with their associated endpoints.
     */
    const buildScopeMap = (spec) => {
        const oauth2 = ((spec.components || {}).securitySchemes || {}).OAuth2 || {};
        const declaredScopes = ((oauth2.flows || {}).authorizationCode || {}).scopes || {};
        const scopes = {};

        Object.keys(declaredScopes).forEach((name) => {
            scopes[name] = {name: name, endpoints: []};
        });

        $.each(spec.paths || {}, (path, methods) => {
            HTTP_METHODS.forEach((method) => {
                const op = methods[method];

                if (!op) {
                    return;
                }

                const security = op.security || [];

                security.forEach((entry) => {
                    const scopeList = entry.OAuth2 || [];

                    scopeList.forEach((scopeName) => {
                        if (!scopes[scopeName]) {
                            // Defensive: a scope used by an endpoint but missing from
                            // the securitySchemes list (shouldn't happen, but don't drop data).
                            scopes[scopeName] = {name: scopeName, endpoints: []};
                        }

                        scopes[scopeName].endpoints.push({
                            method: method,
                            path: path,
                            operationId: op.operationId,
                            summary: op.summary || '',
                            tags: op.tags || []
                        });
                    });
                });
            });
        });

        const list = $.map(scopes, (scope) => scope);

        list.forEach((scope) => {
            scope.endpoints.sort((a, b) => {
                return a.path === b.path
                    ? a.method.localeCompare(b.method) // jshint ignore:line
                    : a.path.localeCompare(b.path);
            });
        });

        list.sort((a, b) => a.name.localeCompare(b.name));

        return list;
    };

    /**
     * Generate the HTML for a single endpoint row in the scope panel.
     *
     * @param {Object} endpoint - The endpoint object containing method, path, operationId, summary, and tags.
     * @returns {`<li class='list-group-item'><span class='badge ${*} scope-method'>${*}</span> <code>${string|*|jQuery}</code>${string|string}</li>`|`<li class='list-group-item'><span class='badge bg-default scope-method'>${*}</span> <code>${string|*|jQuery}</code>${string|string}</li>`}
     */
    const endpointRowHtml = (endpoint) => {
        const methodClass = METHOD_LABEL_CLASS[endpoint.method] || 'bg-default';
        const explorerLink = endpoint.operationId
            ? EXPLORER_URL + encodeURIComponent(endpoint.operationId) // jshint ignore:line
            : null;
        const pathHtml = explorerLink
            ? `<a href="${explorerLink}" target="_blank" rel="noopener noreferrer" class="external-link" referrerpolicy="no-referrer">${escapeHtml(endpoint.path)}</a>` // jshint ignore:line
            : escapeHtml(endpoint.path);

        return (
            `<li class="list-group-item"><span class="badge ${methodClass} scope-method">${endpoint.method.toUpperCase()}</span> <code>${pathHtml}</code>${endpoint.summary ? '<br><span class="text-muted">' + escapeHtml(endpoint.summary) + '</span>' : ''}</li>`
        );
    };

    /**
     * Generate the HTML for a scope panel, including its header and body with associated endpoints.
     *
     * @param {Object} scope - The scope object containing name and endpoints.
     * @param {Array} endpointsToShow - The list of endpoints to display in the panel.
     * @param {boolean} expanded - Whether the panel should be initially expanded.
     * @returns {`<div class='accordion-item'>${string}${string}</div>`}
     */
    const scopePanelHtml = (scope, endpointsToShow, expanded) => {
        const panelId = 'scope-panel-' + scope.name.replace(/[^a-zA-Z0-9]/g, '-');
        const body = endpointsToShow.length
            ? `<ul class="list-group">${endpointsToShow.map(endpointRowHtml).join('')}</ul>` // jshint ignore:line
            : `<div class="panel-body"><em class="text-muted">${aa_esi_oauth2_scopes_translations.no_endpoints_message}</em></div>`;

        const accordionHeader = `<h2 class="accordion-header" id="panel-${panelId}-heading"><button class="accordion-button${!expanded ? ' collapsed' : ''}" type="button" data-bs-toggle="collapse" data-bs-target="#panel-${panelId}" aria-expanded="${expanded ? 'true' : 'false'}" aria-controls="panel-${panelId}"><code>${escapeHtml(scope.name)}</code>&nbsp;<span class="badge text-bg-secondary">${formatTemplateTranslation(aa_esi_oauth2_scopes_translations.endpoint_message, { count: scope.endpoints.length })}</span></button></h2>`;
        const accordionBody = `<div id="panel-${panelId}" class="accordion-collapse collapse${expanded ? ' show' : ''}" aria-labelledby="panel-${panelId}-heading"><div class="accordion-body">${body}</div></div>`;

        return (
            `<div class="accordion-item">${accordionHeader}${accordionBody}</div>`
        );
    };

    /**
     * Check if a haystack string contains the query string, case-insensitively.
     *
     * @param {string} haystack - The string to search within.
     * @param {string} q - The query string to search for.
     * @returns {boolean} - True if the haystack contains the query, false otherwise.
     */
    const matchesQuery = (haystack, q) => {
        return haystack.toLowerCase().indexOf(q) !== -1;
    };

    /**
     * Check if an endpoint matches the query string in any of its relevant fields (path, summary, operationId, or tags).
     *
     * @param {Object} endpoint - The endpoint object to check.
     * @param {string} q - The query string to search for.
     * @returns {boolean} - True if the endpoint matches the query, false otherwise.
     */
    const endpointMatches = (endpoint, q) => {
        return matchesQuery(endpoint.path, q)
            || matchesQuery(endpoint.summary, q) // jshint ignore:line
            || matchesQuery(endpoint.operationId || '', q) // jshint ignore:line
            || endpoint.tags.some((tag) => matchesQuery(tag, q)); // jshint ignore:line
    };

    /**
     * Render the scopes panel search result.
     *
     * @param {string} query - The search query string.
     */
    const render = (query) => {
        if (!currentScopes) {
            return;
        }

        const q = $.trim(query || '').toLowerCase();
        const $list = $('#scopes-list').empty();
        let shown = 0;

        currentScopes.forEach((scope) => {
            const scopeNameMatches = !q || matchesQuery(scope.name, q);
            const matchingEndpoints = q && !scopeNameMatches
                ? scope.endpoints.filter((e) => endpointMatches(e, q)) // jshint ignore:line
                : scope.endpoints;

            const visible = scopeNameMatches || matchingEndpoints.length > 0;

            if (!visible) {
                return;
            }

            shown++;

            // A whole-scope-name match is browsed casually (collapsed);
            // an endpoint-level match is the user hunting for one specific endpoint,
            // so surface it open immediately.
            const expanded = !!q && !scopeNameMatches;

            $list.append(scopePanelHtml(scope, matchingEndpoints, expanded));
        });

        $('#scopes-count').text(formatTemplateTranslation(
            aa_esi_oauth2_scopes_translations.showing_scopes_message,
            {
                number: shown,
                total: currentScopes.length
            }
        ));

        if (shown === 0) {
            const translatedText = formatTemplateTranslation(
                aa_esi_oauth2_scopes_translations.no_match_message,
                {
                    query: query
                }
            );

            $list.html(`<p class="text-muted">${translatedText}</p>`);
        }
    };

    /**
     * Show the specification for a given date.
     *
     * @param {Object} spec - The OpenAPI specification object.
     * @param {string} date - The date of the specification.
     */
    const showSpec = (spec, date) => {
        currentScopes = buildScopeMap(spec);
        const totalEndpoints = currentScopes.reduce((n, s) => n + s.endpoints.length, 0);

        $('#scopes-status')
            .stop(true, true)
            .show()
            .removeClass('alert-info alert-danger')
            .addClass('alert-success')
            .text(formatTemplateTranslation(
                aa_esi_oauth2_scopes_translations.scopes_count_message,
                {
                    current_scopes_length: currentScopes.length,
                    total_endpoints: totalEndpoints,
                    date: date
                }
            ));
        // .delay(2000)
        // .fadeOut(400);

        $('#scopes-controls-wrap').removeClass('d-none');

        render($('#scopes-search').val());
    };

    /**
     * Handle a failure to load the specification.
     *
     * @param {string} textStatus - The status text of the failure.
     */
    const fail = (textStatus) => {
        $('#scopes-status')
            .stop(true, true)
            .show()
            .removeClass('alert-info alert-success')
            .addClass('alert-danger')
            .text(formatTemplateTranslation(
                aa_esi_oauth2_scopes_translations.load_error_message,
                {
                    textstatus: textStatus
                }
            ));
    };

    /**
     * Get a cached specification for a given date.
     *
     * @param {string} date - The date of the specification.
     * @returns {Object|null} The cached specification or null if not found.
     */
    const cacheGet = (date) => {
        try {
            const cached = JSON.parse(localStorage.getItem(CACHE_PREFIX + date) || 'null');

            if (cached && cached.fetchedAt && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
                return cached.spec;
            }
        } catch (e) { // eslint-disable-line no-unused-vars
            // Corrupt/unavailable localStorage: treat as a cache miss.
        }

        return null;
    };

    /**
     * Cache a specification for a given date.
     *
     * @param {string} date - The date of the specification.
     * @param {Object} spec - The OpenAPI specification object.
     */
    const cacheSet = (date, spec) => {
        try {
            localStorage.setItem(CACHE_PREFIX + date, JSON.stringify({
                fetchedAt: Date.now(),
                spec: spec
            }));
        } catch (e) { // eslint-disable-line no-unused-vars
            // Spec is several hundred KB; ignore quota errors and just skip caching.
        }
    };

    /**
     * Load the specification for a given date.
     *
     * @param {string} date - The date of the specification.
     */
    const loadSpecForDate = (date) => {
        const cached = cacheGet(date);

        if (cached) {
            showSpec(cached, date);

            return;
        }

        $('#scopes-status')
            .stop(true, true)
            .show()
            .removeClass('alert-success alert-danger')
            .addClass('alert-info')
            .text(formatTemplateTranslation(
                aa_esi_oauth2_scopes_translations.loading_scopes_message,
                {
                    date: date
                }
            ));

        fetch(OPENAPI_URL, {
            headers: {
                'X-Compatibility-Date': date
            }
        })
            .then((resp) => {
                if (!resp.ok) {
                    throw new Error(formatTemplateTranslation(
                        aa_esi_oauth2_scopes_translations.failed_load_spec_message,
                        {
                            status: resp.status,
                            statustext: resp.statusText
                        }
                    ));
                }

                return resp.json();
            })
            .then((spec) => {
                cacheSet(date, spec);
                showSpec(spec, date);
            })
            .catch((err) => {
                fail(err.toString());
            });
    };

    /**
     * Initialize the compatibility dates dropdown.
     */
    const initCompatDates = () => {
        fetch(COMPAT_DATES_URL)
            .then((resp) => {
                if (!resp.ok) {
                    throw new Error(formatTemplateTranslation(
                        aa_esi_oauth2_scopes_translations.failed_load_compatibility_dates_message,
                        {
                            status: resp.status, statustext:
                            resp.statusText
                        }
                    ));
                }

                return resp.json();
            })
            .then((data) => {
                const dates = (data.compatibility_dates || []).slice().sort().reverse();

                if (!dates.length) {
                    fail(aa_esi_oauth2_scopes_translations.no_compatibility_dates_message);

                    return;
                }

                const $select = $('#scopes-compat-date').empty();

                dates.forEach((date, i) => {
                    $select.append(
                        $('<option>').val(date).text(date + (i === 0 ? ' (' + aa_esi_oauth2_scopes_translations.most_recent_message + ')' : ''))
                    );
                });

                loadSpecForDate(dates[0]);
            })
            .catch((err) => {
                fail(err.toString());
            });
    };

    /**
     * Handle a change in the compatibility dates dropdown.
     */
    $('#scopes-compat-date').on('change', (event) => {
        const _this = event.target;

        loadSpecForDate($(_this).val());
    });

    /**
     * Handle input in the search field.
     */
    $('#scopes-search').on('input', (event) => {
        const _this = event.target;

        render($(_this).val());
    });

    initCompatDates();
});
