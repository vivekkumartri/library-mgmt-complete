const repos = require('../repositories');
const { uuid } = require('../utils/id');

class AuditService {
  async log({ actor, action, entity, entityId, previousValue, newValue, ip, device }) {
    const record = {
      log_id: uuid(),
      actor_id: actor?.id || 'system',
      actor_name: actor?.name || 'system',
      action,
      entity,
      entity_id: entityId,
      previous_value_json: previousValue ? JSON.stringify(previousValue) : '',
      new_value_json: newValue ? JSON.stringify(newValue) : '',
      timestamp: new Date().toISOString(),
      ip: ip || '',
      device: device || '',
    };
    // Audit logging must never block or crash the primary operation it is
    // recording — log failures are swallowed (and console-logged) rather
    // than surfaced to the user as a request failure.
    try {
      await repos.auditLog.create(record);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[audit] failed to write audit log entry', err.message);
    }
    return record;
  }
}

module.exports = new AuditService();
