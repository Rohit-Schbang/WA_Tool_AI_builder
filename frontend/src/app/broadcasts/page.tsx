"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/auth";
import { Sidebar } from "@/app/components/Sidebar";

// NOTE: This page is intentionally STATIC for now — the data below is
// placeholder content matching the design. Wire it to a real /broadcasts
// endpoint later.

type Status = "delivered" | "in_progress" | "scheduled" | "draft";

interface Campaign {
  name: string;
  template: string;
  extra: string;
  icon: string;
  iconTone: string; // tailwind classes for the icon chip
  audience: string;
  recipients: string;
  scheduleTop: string;
  scheduleBottom: string;
  scheduleBottomTone?: string;
  perfLabel: string;
  perfRight: string;
  perfRightTone?: string;
  barPrimary: number; // %
  barSecondary?: number; // %
  barPrimaryColor: string;
  barSecondaryColor?: string;
  perfFoot: string;
  status: Status;
}

const CAMPAIGNS: Campaign[] = [
  {
    name: "Black Friday VIP Early Access",
    template: "vip_exclusive_offer",
    extra: "• 2 CTA Buttons",
    icon: "celebration",
    iconTone: "bg-surface-container text-primary",
    audience: "VIP Customers",
    recipients: "4,250 recipients",
    scheduleTop: "Oct 28, 2024",
    scheduleBottom: "09:15 AM (Instant)",
    perfLabel: "Delivered: 99.2%",
    perfRight: "Read: 88.4%",
    perfRightTone: "text-primary font-semibold",
    barPrimary: 88.4,
    barSecondary: 10.8,
    barPrimaryColor: "bg-primary",
    barSecondaryColor: "bg-primary-fixed-dim",
    perfFoot: "4,216 delivered • 3,757 read",
    status: "delivered",
  },
  {
    name: "Abandoned Cart 24h Follow-up",
    template: "cart_reminder_discount",
    extra: "• Dynamic Code",
    icon: "shopping_cart_checkout",
    iconTone: "bg-surface-container-high text-secondary",
    audience: "Cart Drop-offs",
    recipients: "1,180 recipients",
    scheduleTop: "Today",
    scheduleBottom: "Streaming active",
    scheduleBottomTone: "text-secondary font-medium",
    perfLabel: "Pacing: 52.5%",
    perfRight: "620 / 1,180",
    perfRightTone: "text-secondary font-medium",
    barPrimary: 52.5,
    barPrimaryColor: "bg-secondary-container",
    perfFoot: "Cloud API speed: 85 msg/sec",
    status: "in_progress",
  },
  {
    name: "Monthly Product Update Digest",
    template: "product_newsletter_v3",
    extra: "• Rich Media Card",
    icon: "newspaper",
    iconTone: "bg-surface-container text-tertiary",
    audience: "All Verified Leads",
    recipients: "12,400 recipients",
    scheduleTop: "Tomorrow",
    scheduleBottom: "10:00 AM UTC",
    scheduleBottomTone: "text-tertiary font-medium",
    perfLabel: "Scheduled Queue",
    perfRight: "0 / 12,400",
    barPrimary: 0,
    barPrimaryColor: "bg-tertiary-container",
    perfFoot: "Throttling rule: 1,000/min",
    status: "scheduled",
  },
  {
    name: "Order Tracking System Alert",
    template: "shipping_notification",
    extra: "• Quick Reply",
    icon: "local_shipping",
    iconTone: "bg-surface-container text-primary",
    audience: "Active Buyers",
    recipients: "890 recipients",
    scheduleTop: "Oct 26, 2024",
    scheduleBottom: "02:30 PM (Triggered)",
    perfLabel: "Delivered: 99.8%",
    perfRight: "Read: 94.2%",
    perfRightTone: "text-primary font-semibold",
    barPrimary: 94.2,
    barSecondary: 5.6,
    barPrimaryColor: "bg-primary",
    barSecondaryColor: "bg-primary-fixed-dim",
    perfFoot: "888 delivered • 838 read",
    status: "delivered",
  },
  {
    name: "Re-engagement Special Discount",
    template: "inactive_reactivation",
    extra: "• Coupon Flow",
    icon: "drafts",
    iconTone: "bg-surface-container text-outline",
    audience: "60d Inactive",
    recipients: "3,400 recipients",
    scheduleTop: "Not scheduled",
    scheduleBottom: "Modified 3h ago",
    perfLabel: "Draft Setup",
    perfRight: "Ready to configure",
    barPrimary: 0,
    barPrimaryColor: "bg-outline",
    perfFoot: "Meta template approved",
    status: "draft",
  },
];

function StatusBadge({ status }: { status: Status }) {
  switch (status) {
    case "delivered":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container text-primary font-label-sm text-label-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-primary"></span>
          Delivered
        </span>
      );
    case "in_progress":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-secondary-fixed text-on-secondary-fixed-variant font-label-sm text-label-sm">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary-container opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-secondary-container"></span>
          </span>
          In Progress
        </span>
      );
    case "scheduled":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-high text-tertiary font-label-sm text-label-sm">
          <span className="material-symbols-outlined text-[14px]">schedule</span>
          Scheduled
        </span>
      );
    case "draft":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container text-on-surface-variant font-label-sm text-label-sm">
          <span className="material-symbols-outlined text-[14px]">edit_note</span>
          Draft
        </span>
      );
  }
}

export default function BroadcastsPage() {
  const router = useRouter();

  useEffect(() => {
    if (!getToken()) router.push("/login");
  }, [router]);

  return (
    <div className="bg-surface font-sans text-on-surface antialiased min-h-screen">
      <Sidebar active="broadcasts" />

      <div className="pl-72 flex flex-col min-h-screen">
        {/* Header */}
        <header className="fixed top-0 left-72 right-0 h-16 bg-surface/85 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)] z-40 flex items-center justify-between px-space-lg">
          <div className="flex items-center gap-space-md">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-container-lowest shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
              <span className="h-2 w-2 rounded-full bg-primary"></span>
              <span className="font-label-sm text-label-sm text-on-surface">Meta Cloud Connected</span>
              <span className="font-label-sm text-label-sm text-on-surface-variant font-normal">• Active</span>
            </div>
          </div>
          <div className="flex items-center gap-space-md">
            <a className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high font-label-md text-label-md transition-all" href="#">
              <span className="material-symbols-outlined text-[18px]">help</span>
              <span>Help / Docs</span>
            </a>
            <button aria-label="Notifications" className="relative p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-all">
              <span className="material-symbols-outlined text-[20px]">notifications</span>
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-secondary-container"></span>
            </button>
          </div>
        </header>

        <main className="w-full pt-16 bg-surface flex-1">
          <div className="px-margin flex flex-col max-w-[1440px] mx-auto w-full gap-space-xl py-space-xl pb-16">
            {/* Breadcrumb */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="font-label-md text-label-md text-on-surface-variant">Workspace</span>
                <span className="material-symbols-outlined text-[14px] text-outline">chevron_right</span>
                <span className="font-label-md text-label-md text-primary font-semibold">Broadcasts</span>
              </div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-low text-primary font-label-sm text-label-sm">
                <span className="material-symbols-outlined text-[14px]">shield_with_heart</span>
                Quality Rating: High (Green)
              </span>
            </div>

            {/* Header section */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-space-md">
              <div className="flex flex-col gap-1 max-w-2xl">
                <h1 className="font-headline-xl text-headline-xl text-on-surface tracking-tight">
                  WhatsApp Broadcasts &amp; Bulk Campaigns
                </h1>
                <p className="font-body-md text-body-md text-on-surface-variant leading-relaxed">
                  Schedule targeted one-to-many WhatsApp notification campaigns with verified delivery analytics.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-surface-container-lowest text-on-surface font-label-lg text-label-lg shadow-sm hover:bg-surface-container-low transition-all">
                  <span className="material-symbols-outlined text-[18px] text-on-surface-variant">file_download</span>
                  Export Report
                </button>
                <button className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-on-primary font-label-lg text-label-lg shadow-sm hover:bg-primary-container transition-all active:scale-[0.99]">
                  <span className="material-symbols-outlined text-[18px]">add</span>
                  New Broadcast
                </button>
              </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-lg">
              <div className="p-space-lg rounded-xl bg-surface-container-lowest shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">Total Dispatched</span>
                  <span className="material-symbols-outlined text-[20px] text-primary">mark_chat_read</span>
                </div>
                <div className="mt-4 flex flex-col">
                  <span className="font-headline-xl text-headline-xl text-on-surface font-bold tracking-tight">142,850</span>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="font-label-sm text-label-sm text-primary font-semibold flex items-center">
                      <span className="material-symbols-outlined text-[14px]">trending_up</span> +14.2%
                    </span>
                    <span className="font-body-sm text-body-sm text-on-surface-variant">Delivered past 30 days</span>
                  </div>
                </div>
              </div>

              <div className="p-space-lg rounded-xl bg-surface-container-lowest shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">Avg. Open / Read Rate</span>
                  <span className="material-symbols-outlined text-[20px] text-primary">visibility</span>
                </div>
                <div className="mt-4 flex flex-col">
                  <span className="font-headline-xl text-headline-xl text-on-surface font-bold tracking-tight">84.6%</span>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="font-label-sm text-label-sm text-primary font-semibold">9.4x</span>
                    <span className="font-body-sm text-body-sm text-on-surface-variant">vs standard email (Within 15m)</span>
                  </div>
                </div>
              </div>

              <div className="p-space-lg rounded-xl bg-surface-container-lowest shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">Active Campaigns</span>
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary-container opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-secondary-container"></span>
                  </span>
                </div>
                <div className="mt-4 flex flex-col">
                  <div className="flex items-baseline gap-2">
                    <span className="font-headline-xl text-headline-xl text-on-surface font-bold tracking-tight">3</span>
                    <span className="font-label-md text-label-md text-secondary font-semibold">Running live</span>
                  </div>
                  <span className="mt-1 font-body-sm text-body-sm text-on-surface-variant">1 streaming now, 2 scheduled</span>
                </div>
              </div>

              <div className="p-space-lg rounded-xl bg-surface-container-lowest shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">Meta Messaging Tier</span>
                  <span className="material-symbols-outlined text-[20px] text-primary">cloud_done</span>
                </div>
                <div className="mt-4 flex flex-col">
                  <span className="font-headline-xl text-headline-xl text-on-surface font-bold tracking-tight">Tier 3</span>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="font-label-sm text-label-sm text-primary font-semibold">100k / 24h limit</span>
                    <span className="font-body-sm text-body-sm text-on-surface-variant">Unrestricted concurrency</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Toolbar */}
            <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-space-md bg-surface-container-lowest p-space-md rounded-xl shadow-sm">
              <div className="relative flex-1 max-w-md">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">search</span>
                <input
                  className="w-full pl-9 pr-4 py-2 bg-surface rounded-lg font-body-md text-body-md text-on-surface placeholder:text-outline focus:outline-none focus:bg-surface-container-lowest transition-all"
                  placeholder="Search broadcasts by name, template, or tag..."
                  type="text"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex p-1 rounded-lg bg-surface gap-1">
                  <button className="px-3 py-1.5 rounded-lg bg-surface-container-lowest shadow-sm font-label-sm text-label-sm text-primary font-semibold">
                    All Broadcasts (12)
                  </button>
                  <button className="px-3 py-1.5 rounded-lg text-on-surface-variant hover:text-on-surface font-label-sm text-label-sm">
                    Completed (8)
                  </button>
                  <button className="px-3 py-1.5 rounded-lg text-on-surface-variant hover:text-on-surface font-label-sm text-label-sm">
                    Scheduled (2)
                  </button>
                  <button className="px-3 py-1.5 rounded-lg text-on-surface-variant hover:text-on-surface font-label-sm text-label-sm">
                    Draft (2)
                  </button>
                </div>
                <button className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-surface hover:bg-surface-container font-label-sm text-label-sm text-on-surface transition-all">
                  <span className="material-symbols-outlined text-[16px] text-outline">group</span>
                  <span>All Audiences</span>
                  <span className="material-symbols-outlined text-[16px] text-outline">arrow_drop_down</span>
                </button>
                <button className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-surface hover:bg-surface-container font-label-sm text-label-sm text-on-surface transition-all">
                  <span className="material-symbols-outlined text-[16px] text-outline">tune</span>
                  <span>Filter</span>
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden flex flex-col">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[900px]">
                  <thead>
                    <tr className="bg-surface-container-low text-on-surface-variant font-label-sm text-label-sm uppercase tracking-wider">
                      <th className="py-3.5 px-space-lg">Campaign Name &amp; Template</th>
                      <th className="py-3.5 px-space-md">Target Audience</th>
                      <th className="py-3.5 px-space-md">Schedule &amp; Date</th>
                      <th className="py-3.5 px-space-md min-w-[220px]">Performance / Delivery</th>
                      <th className="py-3.5 px-space-md">Status</th>
                      <th className="py-3.5 px-space-lg text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-container">
                    {CAMPAIGNS.map((c) => (
                      <tr key={c.name} className="hover:bg-surface-bright transition-colors group">
                        <td className="py-4 px-space-lg">
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${c.iconTone}`}>
                              <span className="material-symbols-outlined text-[20px]">{c.icon}</span>
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="font-headline-sm text-headline-sm text-on-surface truncate">{c.name}</span>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="font-label-sm text-label-sm text-primary font-mono bg-surface-container-low px-1.5 py-0.5 rounded">
                                  {c.template}
                                </span>
                                <span className="font-body-sm text-body-sm text-on-surface-variant">{c.extra}</span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-4 px-space-md">
                          <div className="flex flex-col">
                            <span className="font-body-md text-body-md text-on-surface font-medium">{c.audience}</span>
                            <span className="font-body-sm text-body-sm text-on-surface-variant">{c.recipients}</span>
                          </div>
                        </td>
                        <td className="py-4 px-space-md">
                          <div className="flex flex-col">
                            <span className="font-body-md text-body-md text-on-surface">{c.scheduleTop}</span>
                            <span className={`font-body-sm text-body-sm ${c.scheduleBottomTone ?? "text-on-surface-variant"}`}>
                              {c.scheduleBottom}
                            </span>
                          </div>
                        </td>
                        <td className="py-4 px-space-md">
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between font-label-sm text-label-sm">
                              <span className="text-on-surface">{c.perfLabel}</span>
                              <span className={c.perfRightTone ?? "text-on-surface-variant"}>{c.perfRight}</span>
                            </div>
                            <div className="w-full bg-surface-container h-2 rounded-full overflow-hidden flex">
                              <div className={`${c.barPrimaryColor} h-full`} style={{ width: `${c.barPrimary}%` }}></div>
                              {c.barSecondary != null && c.barSecondaryColor && (
                                <div className={`${c.barSecondaryColor} h-full`} style={{ width: `${c.barSecondary}%` }}></div>
                              )}
                            </div>
                            <span className="font-body-sm text-body-sm text-on-surface-variant">{c.perfFoot}</span>
                          </div>
                        </td>
                        <td className="py-4 px-space-md">
                          <StatusBadge status={c.status} />
                        </td>
                        <td className="py-4 px-space-lg text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button className="p-1.5 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container transition-all" title="View">
                              <span className="material-symbols-outlined text-[18px]">analytics</span>
                            </button>
                            <button className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all" title="Clone">
                              <span className="material-symbols-outlined text-[18px]">content_copy</span>
                            </button>
                            <button className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all" title="Options">
                              <span className="material-symbols-outlined text-[18px]">more_vert</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="px-6 py-4 bg-surface-container-lowest border-t border-surface-container flex flex-col sm:flex-row items-center justify-between gap-4 select-none">
                <div className="flex items-center gap-2 text-on-surface-variant font-body-sm text-body-sm">
                  <span>
                    Showing <strong className="font-semibold text-on-surface">1-5</strong> of{" "}
                    <strong className="font-semibold text-on-surface">12</strong> campaigns
                  </span>
                </div>
                <div className="flex items-center gap-2 font-body-sm text-body-sm text-on-surface-variant">
                  <span>Rows per page:</span>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-container-low text-on-surface font-medium border border-surface-container hover:bg-surface-container transition-all cursor-pointer">
                    <span>5</span>
                    <span className="material-symbols-outlined text-[16px] text-outline">expand_more</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-outline hover:text-on-surface hover:bg-surface-container-low transition-all disabled:opacity-40 disabled:hover:bg-transparent"
                    disabled
                    title="Previous Page"
                  >
                    <span className="material-symbols-outlined text-[18px]">chevron_left</span>
                  </button>
                  <button className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm font-bold shadow-sm">
                    1
                  </button>
                  <button className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low font-label-sm text-label-sm font-medium transition-all">
                    2
                  </button>
                  <button className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low font-label-sm text-label-sm font-medium transition-all">
                    3
                  </button>
                  <button className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition-all" title="Next Page">
                    <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
