$(document).ready(() => {
    'use strict';

    const OPENAPI_URL = 'https://esi.evetech.net/meta/openapi.json';
    const COMPAT_DATES_URL = 'https://esi.evetech.net/meta/compatibility-dates';
    const EXPLORER_URL = 'https://developers.eveonline.com/api-explorer#/operations/';
    const CACHE_PREFIX = 'esiScopesOpenApiCache.v2.';

    // Cache scopes/endpoints for a given date until 11:30 UTC to avoid hammering ESI on every visit.
    // Compute milliseconds until the next occurrence of 11:30 UTC.
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

    const escapeHtml = (s) => {
        return $('<div>').text(s === null ? '' : s).html();
    };

    // Builds scope -> [endpoint, ...] from the OpenAPI document.
    // Every operation in ESI's spec requires at most one OAuth2 scope (never an AND of several),
    // so a single security entry per operation is enough.
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

    const scopePanelHtml = (scope, endpointsToShow, expanded) => {
        const panelId = 'scope-panel-' + scope.name.replace(/[^a-zA-Z0-9]/g, '-');
        const body = endpointsToShow.length
            ? `<ul class="list-group">${endpointsToShow.map(endpointRowHtml).join('')}</ul>` // jshint ignore:line
            : '<div class="panel-body"><em class="text-muted">No endpoints currently require this scope.</em></div>';

        const accordionHeader = `<h2 class="accordion-header" id="panel-${panelId}-heading"><button class="accordion-button${!expanded ? ' collapsed' : ''}" type="button" data-bs-toggle="collapse" data-bs-target="#panel-${panelId}" aria-expanded="${expanded ? 'true' : 'false'}" aria-controls="panel-${panelId}"><code>${escapeHtml(scope.name)}</code> <span class="badge">${scope.endpoints.length} endpoint${scope.endpoints.length === 1 ? '' : 's'}</span></button></h2>`;
        const accordionBody = `<div id="panel-${panelId}" class="accordion-collapse collapse${expanded ? ' show' : ''}" aria-labelledby="panel-${panelId}-heading"><div class="accordion-body">${body}</div></div>`;

        return (
            `<div class="accordion-item">${accordionHeader}${accordionBody}</div>`
        );
    };

    const matchesQuery = (haystack, q) => {
        return haystack.toLowerCase().indexOf(q) !== -1;
    };

    const endpointMatches = (endpoint, q) => {
        return matchesQuery(endpoint.path, q)
            || matchesQuery(endpoint.summary, q) // jshint ignore:line
            || matchesQuery(endpoint.operationId || '', q) // jshint ignore:line
            || endpoint.tags.some((tag) => matchesQuery(tag, q)); // jshint ignore:line
    };

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

        $('#scopes-count').text('Showing ' + shown + ' of ' + currentScopes.length + ' scopes.');

        if (shown === 0) {
            $list.html(`<p class="text-muted">No scopes or endpoints match &ldquo;${escapeHtml(query)}&rdquo;.</p>`);
        }
    };

    const showSpec = (spec, date) => {
        currentScopes = buildScopeMap(spec);
        const totalEndpoints = currentScopes.reduce((n, s) => n + s.endpoints.length, 0);

        $('#scopes-status')
            .stop(true, true)
            .show()
            .removeClass('alert-info alert-danger')
            .addClass('alert-success')
            .text(`${currentScopes.length} scopes covering ${totalEndpoints} endpoints, for compatibility date ${date}`);
        // .delay(2000)
        // .fadeOut(400);

        $('#scopes-controls-wrap').removeClass('d-none');

        render($('#scopes-search').val());
    };

    const fail = (textStatus) => {
        $('#scopes-status')
            .stop(true, true)
            .show()
            .removeClass('alert-info alert-success')
            .addClass('alert-danger')
            .text(`Could not load the ESI OpenAPI spec (${textStatus}). Try reloading the page.`);
    };

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
            .text(`Loading scopes for compatibility date ${date}…`);

        fetch(OPENAPI_URL, {
            headers: {
                'X-Compatibility-Date': date
            }
        })
            .then((resp) => {
                if (!resp.ok) {
                    throw new Error(`Failed to load OpenAPI spec: ${resp.status} ${resp.statusText}`);
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

    const initCompatDates = () => {
        fetch(COMPAT_DATES_URL)
            .then((resp) => {
                if (!resp.ok) {
                    throw new Error(`Failed to load compatibility dates: ${resp.status} ${resp.statusText}`);
                }

                return resp.json();
            })
            .then((data) => {
                const dates = (data.compatibility_dates || []).slice().sort().reverse();

                if (!dates.length) {
                    fail('No compatibility dates returned');
                    return;
                }

                const $select = $('#scopes-compat-date').empty();

                dates.forEach((date, i) => {
                    $select.append(
                        $('<option>').val(date).text(date + (i === 0 ? ' (most recent)' : ''))
                    );
                });

                loadSpecForDate(dates[0]);
            })
            .catch((err) => {
                fail(err.toString());
            });
    };

    $('#scopes-compat-date').on('change', (event) => {
        const _this = event.target;

        loadSpecForDate($(_this).val());
    });

    $('#scopes-search').on('input', (event) => {
        const _this = event.target;

        render($(_this).val());
    });

    initCompatDates();
});
