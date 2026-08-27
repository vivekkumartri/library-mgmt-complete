/**
 * Creates the first Super Admin account. Run once after setupSheets.js.
 * Usage: node scripts/createSuperAdmin.js "Owner Name" owner@example.com "StrongPassword123"
 */
const authService = require('../src/services/authService');

async function main() {
  const [name, email, password] = process.argv.slice(2);
  if (!name || !email || !password) {
    console.error('Usage: node scripts/createSuperAdmin.js "Name" email@example.com password');
    process.exit(1);
  }
  const admin = await authService.createAdmin(
    { name, email, password, role: 'super_admin', permissions: {} },
    { id: 'bootstrap', name: 'Bootstrap Script' }
  );
  console.log('Super admin created:', { id: admin.admin_id, email: admin.email });
}

main().catch((err) => {
  console.error('Failed to create super admin:', err.message);
  process.exit(1);
});
