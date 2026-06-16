# IPC / REST Entry Point Map

This document maps the current desktop IPC channels and web REST routes before
the entry point unification work. The intended target is thin IPC/REST adapters
calling the same service functions and shared input contracts.

## Legend

- `Aligned`: IPC and REST expose the same behavior.
- `IPC only`: available in desktop mode only.
- `REST only`: available in web/server mode only.
- `Compat`: retained for older callers; new code should prefer the listed successor.
- `Review`: behavior or naming differs enough to check before unifying.

## Serial

| Capability | IPC | REST | Status | Notes |
| --- | --- | --- | --- | --- |
| List all serials | `serial:getAll` | `GET /api/serials` without paging | Compat | Deprecated. Prefer paged list or domain queries. |
| Paged serial list | `serial:list` | `GET /api/serials?paged=1` | Aligned | Uses shared `SerialListQuery` validation. |
| Expiring soon | `serial:getExpiringSoon` | `GET /api/serials/expiring-soon` | Aligned | Dashboard summary path. |
| Version summary | `serial:getVersionSummary` | `GET /api/serials/version-summary` | Aligned | Products summary path. |
| Get by id | `serial:getById` | `GET /api/serials/:id` | Aligned | Same service. |
| Create | `serial:create` | `POST /api/serials` | Aligned | Uses shared serial input validation. |
| Update | `serial:update` | `PUT /api/serials/:id` | Aligned | Uses shared serial update validation. |
| Delete | `serial:delete` | `DELETE /api/serials/:id` | Aligned | Same service. |
| Search | `serial:search` | `GET /api/serials/search?q=` | Aligned | Legacy quick search path; paged list now covers most UI search. |
| Add add-on | `serial:addAddon` | `POST /api/serials/:id/addon` | Aligned | Uses shared add-on validation. |
| Activate | `serial:activate` | `POST /api/serials/:id/activate` | Aligned | Same service. |
| Stop requested flag | `serial:setStopRequested` | `POST /api/serials/:id/stop-requested` | Aligned | REST wraps lifecycle notice errors into response. |
| Renew | `serial:renew` | `POST /api/serials/:id/renew` | Aligned | Same service. |
| Cancel in local DB | `serial:cancelDb` | `POST /api/serials/:id/cancel-db` | Aligned | Same service. |
| Remove module | `serial:removeModule` | `POST /api/serials/:id/remove-module` | Aligned | Same service. |
| Bulk import | `serial:bulkImport` | `POST /api/serials/bulk-import` | Review | IPC opens file dialog; REST expects multipart upload. |
| Download template | `excel:downloadTemplate` | `GET /api/serials/template/download` | Review | IPC opens save dialog; REST streams a file. |
| Export selected serials | `excel:exportSerials` | `POST /api/serials/export` | Aligned | IPC saves through a dialog; REST streams an `.xlsx` file. |
| Export by filter | `excel:exportSerialsByFilter` | none | IPC only | Desktop save-dialog workflow. Consider explicit REST export endpoint only if web export is needed. |
| Stats counts | `stats:counts` | `GET /api/serials/stats/counts` | Aligned | Also `GET /api/serials/stats` in REST. |
| Stats series | `stats:series` | `GET /api/serials/stats/series` | Aligned | Same service. |

## Customer

| Capability | IPC | REST | Status | Notes |
| --- | --- | --- | --- | --- |
| List | `customer:list` | `GET /api/customers` | Aligned | Same service. |
| Serial summaries | `customer:serialSummaries` | `GET /api/customers/serial-summaries` | Aligned | Avoids full serial load in Customers page. |
| Get by id | `customer:getById` | `GET /api/customers/:id` | Aligned | Same service. |
| Create | `customer:create` | `POST /api/customers` | Aligned | Uses shared runtime validation; blank fields remain allowed. |
| Update | `customer:update` | `PUT /api/customers/:id` | Aligned | Uses shared runtime validation; blank fields remain allowed. |
| Delete | `customer:delete` | `DELETE /api/customers/:id` | Aligned | Same service. |
| Search | `customer:search` | `GET /api/customers/search?q=` | Aligned | Uses shared runtime query validation. |
| Merge candidates | `customer:mergeCandidates` | `POST /api/customers/merge-candidates` | Aligned | Uses shared runtime query validation. |

## Orders

| Capability | IPC | REST | Status | Notes |
| --- | --- | --- | --- | --- |
| List pending/all | `order:getPending` | `GET /api/orders` | Compat | Legacy IPC channel name; both adapters return the all-orders list. |
| List grouped | `order:listGrouped` | `GET /api/orders/grouped` | Aligned | Same service. |
| Poll status | `order:getPollStatus` | `GET /api/orders/poll-status` | Aligned | Same service. |
| Poll now | `order:pollNow` | `POST /api/orders/poll-now` | Aligned | Uses shared runtime validation for optional source id. |
| Poll dry run | `order:pollDryRun` | `POST /api/orders/poll-dry-run` | Aligned | Uses shared runtime validation for source id and override shape. |
| Restart scheduler | `order:restartScheduler` | `POST /api/orders/restart-scheduler` | Aligned | Same scheduler function. |
| Update | `order:update` | `PUT /api/orders/:id` | Aligned | Uses shared runtime validation; blank order fields remain allowed. |
| Approve | `order:approve` | `POST /api/orders/:id/approve` | Aligned | Uses shared runtime validation for status/customer options. |
| Update data and approve | `order:updateData` | `POST /api/orders/:id/update-data` | Aligned | Uses shared runtime validation; blank order fields remain allowed. |
| Reject | `order:reject` | `POST /api/orders/:id/reject` | Aligned | Uses shared id validation. |
| Delete | `order:delete` | `DELETE /api/orders/:id` | Aligned | Uses shared id validation. |
| List all | `order:listAll` | none | Removed candidate | Declared in `IPC_CHANNELS` but no handler or caller was found. |

## Cancel And Automation

| Capability | IPC | REST | Status | Notes |
| --- | --- | --- | --- | --- |
| Cancel subscription | `cancel:subscription` | `POST /api/cancel/:serialNumber` | Aligned | Same cancel service. |
| Check expired cancel targets | `cancel:checkExpiring` | `POST /api/cancel/run/expired` | Aligned | Naming differs. |
| Pre-expiry auto cancel | `cancel:preExpiryAutoCancel` | `POST /api/cancel/run/pre-expiry` | Aligned | Same service. |
| Cancel dry run | `cancel:dryRun` | `POST /api/cancel/run/dry-run` | Aligned | Same service. |
| Restart cancel scheduler | `cancel:restartScheduler` | `POST /api/cancel/restart-scheduler` | Aligned | Same scheduler function. |
| Run auto renew | `automation:runAutoRenewNow` | `POST /api/automation/run-auto-renew` | Aligned | Same service. |
| Run auto cancel | `automation:runAutoCancelNow` | `POST /api/automation/run-auto-cancel` | Aligned | Same service. |
| Run limbo fallback | `automation:runLimboFallbackNow` | `POST /api/automation/run-limbo-fallback` | Aligned | Same service. |

## Mail And Templates

| Capability | IPC | REST | Status | Notes |
| --- | --- | --- | --- | --- |
| Check inbound now | `mail:checkInboundNow` | `POST /api/mail/check-inbound-now` | Aligned | Same service. |
| Inbound dry run | `mail:inboundDryRun` | `POST /api/mail/inbound-dry-run` | Aligned | Same service. |
| Test connection | `mail:testConnection` | `POST /api/mail/test-connection` | Aligned | Same service. |
| List inbound mails | `mail:listInbound` | `POST /api/mail/inbound-mails` | Aligned | REST uses POST for filtered list. |
| Confirm stop request | `mail:confirmStopRequest` | `POST /api/mail/inbound-mails/:id/confirm-stop` | Aligned | Same service. |
| Send missing info template | `mail:sendMissingInfoTemplate` | `POST /api/mail/inbound-mails/:id/send-missing-info` | Aligned | Same service. |
| Send template | `mail:sendTemplate` | `POST /api/mail/send-template` | Aligned | Same SMTP service. |
| Test SMTP | `mail:testSmtp` | `POST /api/mail/test-smtp` | Aligned | Also duplicated under settings REST. |
| Send test dry run | `mail:sendTestDryRun` | `POST /api/mail/send-test-dry-run` | Aligned | Same service. |
| Template list | `mailTemplate:list` | `GET /api/mail-templates` | Aligned | Same service. |
| Template get | `mailTemplate:get` | `GET /api/mail-templates/:code` | Aligned | Same service. |
| Template preview | `mailTemplate:preview` | `GET /api/mail-templates/:code/preview` | Aligned | REST takes serial id from query. |
| Template upsert | `mailTemplate:upsert` | `POST /api/mail-templates` | Aligned | Same service. |
| Template delete | `mailTemplate:delete` | `DELETE /api/mail-templates/:code` | Aligned | Same service. |

## Settings And Notifications

| Capability | IPC | REST | Status | Notes |
| --- | --- | --- | --- | --- |
| Get settings | `settings:get` | `GET /api/settings` | Aligned | Same service. |
| Save settings | `settings:save` | `POST /api/settings` | Aligned | IPC refreshes schedulers after save; confirm REST does too before unifying. |
| Export settings | `settings:export` | none | IPC only | Desktop save-dialog workflow. |
| Import settings | `settings:import` | none | IPC only | Desktop file-dialog workflow with key allowlist. |
| Test SMTP and send sample mail | none | `POST /api/settings/test-smtp` | Compat | Deprecated REST path. It sends a sample email, while `/api/mail/test-smtp` verifies SMTP connectivity. |
| Test Slack | `notification:testSlack` | `POST /api/settings/test-slack` | Aligned | Same notification service. |
| Test related Slack | none | `POST /api/settings/test-slack-related` | REST only | Decide whether desktop UI needs it. |
| Test mail connection | `mail:testConnection` | `POST /api/settings/test-mail-connection` | Compat | Deprecated REST alias for `/api/mail/test-connection`. |
| Expiry notice dry run | `expiryNotice:dryRun` | `POST /api/settings/expiry-notice-dry-run` | Aligned | Same scheduler/mail path. |
| Stop lifecycle notice dry run | `stopLifecycleNotice:dryRun` | `POST /api/settings/stop-lifecycle-notice-dry-run` | Aligned | Same service. |
| Send daily report now | `notification:sendDailyReportNow` | `POST /api/reports/send-daily` | Aligned | REST is under reports. |
| List report times | `notification:listReportTimes` | none | IPC only | Settings helper; may be desktop-only. |
| Set report times | `notification:setReportTimes` | none | IPC only | Settings helper; may be desktop-only. |

## Logs, Reports, Webhook, Legacy

| Capability | IPC | REST | Status | Notes |
| --- | --- | --- | --- | --- |
| List logs | `logs:list` | `GET /api/logs` | Aligned | Same activity log service. |
| Today logs | none | `GET /api/logs/today` | REST only | Could be covered by list filter if not used. |
| Failure logs | `stats:failures` | none | IPC only | Consider REST parity or move under `/api/logs/failures`. |
| Renewal check | none | `POST /api/logs/renewal-check` | REST only | Mail scan convenience route. |
| Renewal dry run | none | `POST /api/logs/renewal-dry-run` | REST only | Mail scan convenience route. |
| System logs | none | `GET /api/logs/system` | REST only | Operational route. |
| Mail log detail | none | `GET /api/logs/mail/:id` | REST only | Operational route. |
| Screenshot file | none | `GET /api/logs/screenshot/:filename` | REST only | Static-ish operational route. |
| Daily report | none | `GET /api/reports/daily` | REST only | Browser report view. |
| Monthly expiry report | none | `GET /api/reports/monthly-expiry` | REST only | Browser report view. |
| Webhook status | `webhook:getStatus` | `GET /api/webhook/status` | Aligned | Same service. |
| Start webhook | `webhook:start` | `POST /api/webhook/start` | Aligned | Same service. |
| Stop webhook | `webhook:stop` | `POST /api/webhook/stop` | Aligned | Same service. |
| Legacy detect | `legacy:detect` | `GET /api/legacy/detect` | Aligned | Same service. |
| Legacy list serials | `legacy:listSerials` | `POST /api/legacy/serials` | Aligned | Same service. |
| Legacy suggest merge | `legacy:suggestMerge` | `POST /api/legacy/suggest-merge` | Aligned | Same service. |
| Legacy import | `legacy:import` | `POST /api/legacy/import` | Aligned | Same service. |
| Push log event | `logs:push` | none | Event only | Main-to-renderer event sent by `activity-log.service`; no `ipcMain.handle` is expected. |

## Recommended Unification Order

1. Serial and customer contracts first. They already have the most shared shape and the highest UI traffic.
2. Orders now have shared runtime validation. Next order work should focus on reducing `any` in renderer/preload typing.
3. Mail/settings duplicate test routes next. Decide one canonical service contract and keep both adapters thin.
4. Logs/reports/webhook/legacy last. Several REST-only routes are operational/read-only and may not need IPC parity.

## Immediate Cleanup Candidates

- `ORDER_LIST_ALL` was declared but no IPC handler or caller was found.
- `LOGS_PUSH` is not a request channel; keep it as a main-to-renderer event.
- `excel:exportSerials` now has both IPC and REST support; IPC saves through a dialog, REST streams a file.
- `/api/settings/test-smtp` is deprecated but kept because it sends a sample email, unlike `/api/mail/test-smtp`.
- `/api/settings/test-mail-connection` is deprecated in favor of `/api/mail/test-connection`.
