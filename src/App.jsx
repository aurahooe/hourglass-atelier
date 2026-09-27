import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase.js";

function hourKey(d = new Date()) {
  const x = new Date(d);
  x.setMinutes(0, 0, 0);
  return x.toISOString();
}

function prettyHour(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [view, setView] = useState("floor");
  const [publicNotes, setPublicNotes] = useState([]);
  const [mine, setMine] = useState([]);
  const [hours, setHours] = useState([]);
  const [features, setFeatures] = useState([]);
  const [auth, setAuth] = useState({ email: "", password: "", handle: "" });
  const [draft, setDraft] = useState({ title: "", body: "", is_public: true });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function loadPublic() {
    const { data } = await supabase
      .from("notes")
      .select("id,title,body,is_public,created_at,user_id,profiles(handle,display_name)")
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .limit(36);
    setPublicNotes(data || []);
  }

  async function loadHours() {
    const [{ data: h }, { data: f }] = await Promise.all([
      supabase.from("hours").select("*").order("created_at", { ascending: false }).limit(12),
      supabase.from("features").select("*").order("created_at", { ascending: false }).limit(12),
    ]);
    setHours(h || []);
    setFeatures(f || []);
  }

  async function loadMine(userId) {
    if (!userId) return setMine([]);
    const { data } = await supabase
      .from("notes")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    setMine(data || []);
  }

  async function ensureProfile(user) {
    if (!user) return setProfile(null);
    const handle =
      user.user_metadata?.handle ||
      (user.email ? user.email.split("@")[0] : "presshand");
    await supabase.from("profiles").upsert({
      id: user.id,
      handle: handle.slice(0, 24).replace(/[^a-zA-Z0-9_]/g, "_"),
      display_name: handle,
    });
    const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
    setProfile(data);
  }

  useEffect(() => {
    loadPublic();
    loadHours();
  }, []);

  useEffect(() => {
    ensureProfile(session?.user);
    loadMine(session?.user?.id);
  }, [session?.user?.id]);

  const featured = useMemo(() => {
    const key = hourKey(new Date(now));
    const fromFeat = features.find((f) => f.hour_key === key) || features[0];
    const fromHours = hours[0];
    return {
      title: fromFeat?.title || fromHours?.headline || "The press is warming",
      body:
        fromFeat?.body ||
        fromHours?.editorial ||
        "Every hour this room reprints itself. Leave a public slip and it can take the window.",
      when: fromFeat?.hour_key || fromHours?.slot || key,
    };
  }, [features, hours, now]);

  const nextTurn = useMemo(() => {
    const d = new Date(now);
    d.setMinutes(60, 0, 0);
    const left = Math.max(0, d.getTime() - now);
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [now]);

  async function signUp(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email: auth.email,
      password: auth.password,
      options: { data: { handle: auth.handle || auth.email.split("@")[0] } },
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setMsg("Check your inbox if confirmation is on. Otherwise you can sign in now.");
  }

  async function signIn(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: auth.email,
      password: auth.password,
    });
    setBusy(false);
    if (error) setErr(error.message);
    else {
      setMsg("");
      setView("desk");
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setView("floor");
  }

  async function saveNote(e) {
    e.preventDefault();
    if (!session?.user) return;
    setErr("");
    setBusy(true);
    const { error } = await supabase.from("notes").insert({
      user_id: session.user.id,
      title: draft.title.trim() || "Untitled slip",
      body: draft.body.trim(),
      is_public: !!draft.is_public,
    });
    setBusy(false);
    if (error) setErr(error.message);
    else {
      setDraft({ title: "", body: "", is_public: true });
      setMsg("Saved to the desk.");
      loadMine(session.user.id);
      loadPublic();
    }
  }

  async function togglePublic(note) {
    const { error } = await supabase
      .from("notes")
      .update({ is_public: !note.is_public })
      .eq("id", note.id);
    if (!error) {
      loadMine(session.user.id);
      loadPublic();
    }
  }

  async function removeNote(note) {
    const { error } = await supabase.from("notes").delete().eq("id", note.id);
    if (!error) {
      loadMine(session.user.id);
      loadPublic();
    }
  }

  return (
    <div className="shell">
      <header className="mast">
        <div>
          <p className="mark">Hourglass <em>Atelier</em></p>
          <p className="kicker">a living press · turns on the hour</p>
        </div>
        <nav className="nav">
          <button onClick={() => setView("floor")}>The floor</button>
          <button onClick={() => setView("hours")}>Hour book</button>
          {session ? (
            <>
              <button onClick={() => setView("desk")}>Your desk</button>
              <button onClick={signOut}>Lock up</button>
            </>
          ) : (
            <button className="solid" onClick={() => setView("door")}>Come in</button>
          )}
        </nav>
      </header>

      {view === "floor" && (
        <>
          <section className="hero">
            <div>
              <h2>Paper still warm from the last turn.</h2>
              <p className="lede">This is a small room, not a feed. You keep a desk. Private slips stay in the drawer. Anything you mark public hangs on the wall for anyone walking through. Every hour the window changes.</p>
            </div>
            <article className="hour-card">
              <div className="hour-label">This hour</div>
              <h3>{featured.title}</h3>
              <p>{featured.body}</p>
              <div className="ticker">Next turn in {nextTurn} · {prettyHour(featured.when)}</div>
            </article>
          </section>
          <div className="section-head">
            <h3>On the wall</h3>
            <span className="kicker">{publicNotes.length} public slips</span>
          </div>
          {publicNotes.length === 0 ? (
            <p className="empty">The wall is clean. Pin something from your desk.</p>
          ) : (
            <div className="grid">
              {publicNotes.map((n, i) => (
                <article className="slip" key={n.id} style={{ "--r": `${((i % 5) - 2) * 0.7}deg`, "--d": `${(i % 8) * 0.05}s` }}>
                  <h4>{n.title}</h4>
                  <p>{n.body}</p>
                  <div className="meta">{n.profiles?.handle ? `@${n.profiles.handle}` : "anon"} · {new Date(n.created_at).toLocaleDateString()}</div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {view === "hours" && (
        <>
          <div className="section-head">
            <h3>Hour book</h3>
            <span className="kicker">editions kept after each turn</span>
          </div>
          <div className="grid">
            {(features.length ? features : hours).map((h, i) => (
              <article className="slip" key={h.id || h.hour_key || h.slot} style={{ "--r": `${((i % 3) - 1) * 0.4}deg` }}>
                <h4>{h.title || h.headline}</h4>
                <p>{h.body || h.editorial}</p>
                <div className="meta">{prettyHour(h.hour_key || h.slot || h.created_at)}</div>
              </article>
            ))}
          </div>
        </>
      )}

      {view === "door" && !session && (
        <section className="panel">
          <form onSubmit={signIn} className="box">
            <h3 style={{ fontFamily: "Fraunces, serif", marginTop: 0 }}>Sign in</h3>
            <label>Email</label>
            <input type="email" required value={auth.email} onChange={(e) => setAuth({ ...auth, email: e.target.value })} />
            <label>Password</label>
            <input type="password" required minLength={6} value={auth.password} onChange={(e) => setAuth({ ...auth, password: e.target.value })} />
            <div className="row"><button className="solid" disabled={busy}>Open the door</button></div>
          </form>
          <form onSubmit={signUp} className="box">
            <h3 style={{ fontFamily: "Fraunces, serif", marginTop: 0 }}>Take a desk</h3>
            <label>Handle</label>
            <input value={auth.handle} onChange={(e) => setAuth({ ...auth, handle: e.target.value })} placeholder="presshand" />
            <label>Email</label>
            <input type="email" required value={auth.email} onChange={(e) => setAuth({ ...auth, email: e.target.value })} />
            <label>Password</label>
            <input type="password" required minLength={6} value={auth.password} onChange={(e) => setAuth({ ...auth, password: e.target.value })} />
            <div className="row"><button className="ghost" disabled={busy}>Register</button></div>
          </form>
        </section>
      )}

      {view === "desk" && session && (
        <section className="panel">
          <form onSubmit={saveNote}>
            <h3 style={{ fontFamily: "Fraunces, serif", marginTop: 0 }}>{profile?.handle ? `@${profile.handle}` : "Your desk"}</h3>
            <label>Title</label>
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={120} required />
            <label>The slip</label>
            <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} required maxLength={8000} />
            <label className="check">
              <input type="checkbox" checked={draft.is_public} onChange={(e) => setDraft({ ...draft, is_public: e.target.checked })} />
              Hang this on the public wall
            </label>
            <div className="row"><button className="solid" disabled={busy}>Keep</button></div>
          </form>
          <div className="box">
            <h3 style={{ fontFamily: "Fraunces, serif", marginTop: 0 }}>Drawer</h3>
            {mine.length === 0 && <p className="empty">Nothing filed yet.</p>}
            {mine.map((n) => (
              <div key={n.id} style={{ borderBottom: "1px solid var(--rule)", padding: "10px 0" }}>
                <strong>{n.title}</strong>
                <div className="meta">{n.is_public ? "public" : "private"} · {new Date(n.created_at).toLocaleString()}</div>
                <div className="row">
                  <button className="ghost" type="button" onClick={() => togglePublic(n)}>{n.is_public ? "Take down" : "Make public"}</button>
                  <button className="ghost" type="button" onClick={() => removeNote(n)}>Burn</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {err && <p className="err">{err}</p>}
      {msg && <p className="ok">{msg}</p>}
    </div>
  );
}
