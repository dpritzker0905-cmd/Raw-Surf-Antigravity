# Support ticket confirmation emails

The user requested creation confirmations, message-email opt-in for their own account, coordinated mail activation and
a safe backend restart, followed by Gmail verification. Every support email must return communication to the app.

Newly inserted tickets queue one owner-bound `support_created` receipt in the ticket transaction. A keyed ticket retry
returns the original ticket without queuing another receipt; concurrent insertion is arbitrated by the existing unique
constraints. Queue exceptions roll back the ticket. Email opt-out, absent preferences, suppression, quotas and disabled
provider behavior remain intact. Customer follow-ups do not email their own author.

Creation and staff-reply emails contain only a generic notice and authenticated ticket link. Ticket subject, description,
reply content and tokens are excluded. Both omit configured Reply-To and instruct the recipient to communicate in-app.
The existing low-priority delay, daily budget and sweeper are preserved. There is no migration or weather source change.

Validation: the new receipt regression failed against the original code, then the mounted isolated API/outbox fixture
passed 43 cases. The existing fake-transport mailer/template/webhook suite passed 144 cases (140 plus four rendering
cases for the new template). The estate floor rises by exactly four, from 3399 to 3403; expected pass count is 3405 based
on main-target run 41090754079. Floor plus durable support-launcher checks passed 37 cases. No real provider send is
included in these local results.

Live diagnosis before activation found a disabled sender, missing sender/frontend/provider settings, no configured
provider webhook, and an empty outbox. The user's explicitly authorized message-email preference was enabled in one
owner-bound row; all other preference values were preserved. The existing sending subdomain was verified. No credential
value was viewed, copied into a file, or included here.

Live activation, source integration and Gmail receipt remain separate gates. Establish the actual weather owner's safe
restart window before changing the shared backend configuration. The independent E2E lane has released its window.
The shared Claude repair handoff is updated; an attempted launch of Claude Desktop timed out awaiting computer-use
approval, so direct Claude acknowledgement is not claimed. Provider signing-secret entry requires the user's handoff.
Do not bypass signature verification, create duplicate deployments, bulk-redrive unrelated mail or reset preferences.
