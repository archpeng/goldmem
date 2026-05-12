update reminders
set confirmation_required = false
where status in ('confirmed', 'scheduled', 'sent', 'done', 'cancelled', 'expired')
  and confirmation_required = true;
