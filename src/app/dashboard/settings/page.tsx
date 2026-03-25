import SettingsClient from "./SettingsClient";

export const metadata = {
  title: "Settings | LaBrew",
};

// Render client component directly — data is fetched client-side
// to avoid server-side DB calls that cause redirect loops on slow drives.
export default function SettingsPage() {
  return (
    <div className="max-w-4xl mx-auto pb-12">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">⚙️ System Settings</h1>
        <p className="text-sm text-gray-500">Configure behavioral rules, integrations, and view audit logs.</p>
      </div>
      <SettingsClient initialSettings={null} envSettings={null} auditLogs={[]} />
    </div>
  );
}
