import Link from "next/link";

// Landing page at "/". A polished hero for first impressions.
export default function Home() {
  return (
    <main className="min-h-screen">
      {/* Nav */}
      <nav className="navbar bg-base-100/70 backdrop-blur border-b border-base-300 px-6">
        <div className="flex-1">
          <span className="text-xl font-bold flex items-center gap-2">
            <span className="text-2xl">💬</span> WA AI Tool
          </span>
        </div>
        <div className="flex-none gap-2">
          <Link href="/login" className="btn btn-ghost btn-sm">Log in</Link>
          <Link href="/login" className="btn btn-primary btn-sm">Get started</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="hero min-h-[70vh] bg-gradient-to-br from-primary/10 via-base-100 to-secondary/10">
        <div className="hero-content text-center">
          <div className="max-w-2xl">
            <div className="badge badge-primary badge-outline mb-4">WhatsApp Automation</div>
            <h1 className="text-5xl font-extrabold leading-tight">
              Build WhatsApp chatbots <span className="text-primary">without code</span>
            </h1>
            <p className="py-6 text-lg text-base-content/70">
              Design conversation flows on a visual canvas, publish in one click, and let
              your workflow reply to customers automatically.
            </p>
            <div className="flex gap-3 justify-center">
              <Link href="/login" className="btn btn-primary btn-lg">Get started free</Link>
              <Link href="/login" className="btn btn-outline btn-lg">Log in</Link>
            </div>
          </div>
        </div>
      </section>

      {/* Feature cards */}
      <section className="max-w-5xl mx-auto px-6 py-16 grid gap-6 md:grid-cols-3">
        {[
          { icon: "🧩", title: "Visual builder", desc: "Drag nodes, connect them, and shape any conversation flow." },
          { icon: "⚡", title: "Publish instantly", desc: "Validate and publish an immutable version with one click." },
          { icon: "🔌", title: "WhatsApp native", desc: "Connect your WhatsApp Business number and go live." },
        ].map((f) => (
          <div key={f.title} className="card bg-base-100 shadow-md hover:shadow-xl transition-shadow">
            <div className="card-body">
              <div className="text-3xl">{f.icon}</div>
              <h3 className="card-title">{f.title}</h3>
              <p className="text-base-content/70">{f.desc}</p>
            </div>
          </div>
        ))}
      </section>

      <footer className="footer footer-center p-6 text-base-content/50 text-sm">
        <p>WA AI Tool — workflow automation engine with a WhatsApp adapter</p>
      </footer>
    </main>
  );
}
