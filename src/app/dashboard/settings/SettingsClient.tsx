"use client";

import { useState, useTransition, useEffect } from "react";
import { createClient } from "@/lib/supabase/browser";
import { setSetting, rollbackSetting } from "@/lib/domain/settings";
import { timeAgo } from "@/lib/utils";

const DEFAULT_PAYMENTS = { cash: true, gcash: true, bank_transfer: false, hitpay: false };

export default function SettingsClient({ initialSettings, envSettings: _env, auditLogs: _logs }: any) {
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState("operations");
  const [loading, setLoading] = useState(true);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [envSettings, setEnvSettings] = useState({ hitPayApiKeyExists: false, hitPaySaltExists: false, resendApiKeyExists: false });

  const [payments, setPayments] = useState(initialSettings?.payment_methods_enabled ?? DEFAULT_PAYMENTS);
  const [threshold, setThreshold] = useState(initialSettings?.low_stock_threshold ?? 10);
  const [email, setEmail] = useState(initialSettings?.admin_email ?? "");
  const [statusMsg, setStatusMsg] = useState<{type: "success"|"error", text: string} | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem("active_settings_tab");
    if (saved) setActiveTab(saved);

    // Load settings client-side to avoid server component blocking
    async function fetchSettings() {
      try {
        const supabase = createClient();
        const { data } = await supabase.from("system_settings").select("*");
        if (data) {
          const map = data.reduce((acc: any, r: any) => { acc[r.key] = r.value; return acc; }, {});
          if (map.payment_methods_enabled) setPayments(map.payment_methods_enabled);
          if (map.low_stock_threshold) setThreshold(map.low_stock_threshold);
          if (map.admin_email) setEmail(map.admin_email);
        }
        // Fetch audit logs
        const { data: logs } = await supabase
          .from("settings_audit_log")
          .select("*, profiles(full_name)")
          .order("created_at", { ascending: false })
          .limit(50);
        if (logs) setAuditLogs(logs);
      } catch (e) {
        console.error("Settings load error:", e);
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, []);

  const changeTab = (tab: string) => {
    setActiveTab(tab);
    sessionStorage.setItem("active_settings_tab", tab);
  };

  const handleSavePayments = () => {
    startTransition(async () => {
      try {
        await setSetting("payment_methods_enabled", payments);
        setStatusMsg({ type: "success", text: "Payment settings saved." });
      } catch (e: any) {
        setStatusMsg({ type: "error", text: e.message });
      }
    });
  };

  const handleSaveOperations = () => {
    startTransition(async () => {
      try {
        await setSetting("low_stock_threshold", Number(threshold));
        await setSetting("admin_email", email);
        setStatusMsg({ type: "success", text: "Operational settings saved." });
      } catch (e: any) {
        setStatusMsg({ type: "error", text: e.message });
      }
    });
  };

  const handleRollback = (logId: string) => {
    if (!confirm("Are you sure you want to rollback to this configuration snapshot?")) return;
    startTransition(async () => {
      try {
        await rollbackSetting(logId);
        setStatusMsg({ type: "success", text: "Settings rolled back successfully." });
      } catch (e: any) {
        setStatusMsg({ type: "error", text: e.message });
      }
    });
  };

  return (
    <div className="bg-white border text-sm rounded-xl overflow-hidden shadow-sm">
      {/* Tabs */}
      <div className="flex border-b overflow-x-auto">
        {["operations", "payments", "integrations", "audit"].map((tab) => (
          <button
            key={tab}
            onClick={() => changeTab(tab)}
            className={`px-4 py-3 font-medium capitalize whitespace-nowrap ${
              activeTab === tab ? "border-b-2 border-amber-500 text-amber-700" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab === "audit" ? "Audit Log" : tab}
          </button>
        ))}
      </div>

      <div className="p-6">
        {statusMsg && (
          <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${statusMsg.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
            {statusMsg.text}
          </div>
        )}

        {/* OPERATIONS */}
        {activeTab === "operations" && (
          <div className="space-y-6 max-w-lg">
            <div>
              <label className="block font-medium text-gray-700 mb-1">Global Low Stock Threshold</label>
              <p className="text-xs text-gray-500 mb-2">Used to trigger low stock warnings and daily emails.</p>
              <input 
                type="number" 
                value={threshold} 
                onChange={(e) => setThreshold(e.target.value)}
                min={1} max={100}
                className="input-field max-w-[100px]"
              />
            </div>

            <div>
              <label className="block font-medium text-gray-700 mb-1">Admin Notification Email</label>
              <p className="text-xs text-gray-500 mb-2">Internal email to receive low stock and reconciliation alerts.</p>
              <input 
                type="email" 
                value={email} 
                onChange={(e) => setEmail(e.target.value)}
                className="input-field"
                placeholder="admin@labrew.com"
              />
            </div>

            <button onClick={handleSaveOperations} disabled={isPending} className="btn-primary">
              {isPending ? "Saving..." : "Save Operations"}
            </button>
          </div>
        )}

        {/* PAYMENTS */}
        {activeTab === "payments" && (
          <div className="space-y-6 max-w-lg">
            <h3 className="font-medium text-gray-900 mb-4">Enabled Payment Methods</h3>
            
            <div className="space-y-3">
              {Object.keys(payments).map((method) => (
                <label key={method} className="flex items-center gap-3">
                  <input 
                    type="checkbox" 
                    checked={payments[method]} 
                    onChange={(e) => setPayments({...payments, [method]: e.target.checked})}
                    className="w-4 h-4 text-amber-600 rounded focus:ring-amber-500"
                  />
                  <span className="capitalize">{method.replace("_", " ")}</span>
                </label>
              ))}
            </div>

            <button onClick={handleSavePayments} disabled={isPending} className="btn-primary mt-4">
              {isPending ? "Saving..." : "Save Payments"}
            </button>
          </div>
        )}

        {/* INTEGRATIONS */}
        {activeTab === "integrations" && (
          <div className="space-y-6">
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-lg">
              <h3 className="font-medium text-amber-800 mb-1">🔒 Source of Truth Enforcement</h3>
              <p className="text-sm text-amber-700 leading-relaxed">
                For security reasons, API keys and secrets are <strong>never stored in the database</strong> and cannot be modified via this UI. 
                They must be configured in your environment variables (<code>.env.local</code> or hosting provider).
              </p>
            </div>

            <div className="bg-gray-50 border rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Provider / Secret</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Environment Var</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  <tr>
                    <td className="px-4 py-3 font-medium text-gray-900">HitPay API Key</td>
                    <td className="px-4 py-3 text-gray-500"><code className="bg-gray-100 px-1 rounded text-xs">HITPAY_API_KEY</code></td>
                    <td className="px-4 py-3">
                      {envSettings.hitPayApiKeyExists ? <span className="text-green-600 font-medium text-xs bg-green-50 px-2 py-1 rounded">Configured</span> : <span className="text-red-500 font-medium text-xs bg-red-50 px-2 py-1 rounded">Missing</span>}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-medium text-gray-900">HitPay Salt</td>
                    <td className="px-4 py-3 text-gray-500"><code className="bg-gray-100 px-1 rounded text-xs">HITPAY_SALT</code></td>
                    <td className="px-4 py-3">
                      {envSettings.hitPaySaltExists ? <span className="text-green-600 font-medium text-xs bg-green-50 px-2 py-1 rounded">Configured</span> : <span className="text-red-500 font-medium text-xs bg-red-50 px-2 py-1 rounded">Missing</span>}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-medium text-gray-900">Resend API Key</td>
                    <td className="px-4 py-3 text-gray-500"><code className="bg-gray-100 px-1 rounded text-xs">RESEND_API_KEY</code></td>
                    <td className="px-4 py-3">
                      {envSettings.resendApiKeyExists ? <span className="text-green-600 font-medium text-xs bg-green-50 px-2 py-1 rounded">Configured</span> : <span className="text-red-500 font-medium text-xs bg-red-50 px-2 py-1 rounded">Missing</span>}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            
            <div className="mt-4">
               <button 
                onClick={() => alert("Test notification logic goes here.")} 
                className="btn-secondary"
                disabled={!envSettings.resendApiKeyExists}
              >
                Send Test Email
              </button>
            </div>
          </div>
        )}

        {/* AUDIT LOG & VERSIONING */}
        {activeTab === "audit" && (
          <div>
            <div className="flex items-center justify-between mb-4">
               <h3 className="font-medium text-gray-900">Version History &amp; Audit Log</h3>
               <span className="text-xs text-gray-500">Last 50 changes</span>
            </div>
            
            {auditLogs && auditLogs.length > 0 ? (
              <div className="border rounded-lg overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200 text-left">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Time</th>
                      <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Key</th>
                      <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Version</th>
                      <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Changed By</th>
                      <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {auditLogs.map((log: any) => (
                      <tr key={log.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-xs text-gray-500" title={new Date(log.created_at).toLocaleString()}>{timeAgo(log.created_at)}</td>
                        <td className="px-4 py-3 font-medium text-gray-900">{log.key}</td>
                        <td className="px-4 py-3 text-xs">
                          <span className="inline-flex items-center bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded-full">v{log.version}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-700">{log.profiles?.full_name || "Unknown"}</td>
                        <td className="px-4 py-3">
                          <button 
                            onClick={() => handleRollback(log.id)}
                            disabled={isPending}
                            className="text-amber-600 hover:text-amber-800 text-xs font-medium"
                          >
                            Rollback to this state
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-10 border rounded-lg bg-gray-50 text-gray-500">
                No audit logs found. Change a setting to see version tracking.
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
