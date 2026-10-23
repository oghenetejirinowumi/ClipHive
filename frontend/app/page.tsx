import { AuroraBackground, CurveDivider, FeatureCloud, RevealOnScroll, RuleWall, Tape } from "@/components/effects";
import { Badge, Button, Icon, Logo, Panel } from "@/components/ui";
import { SITE } from "@/lib/site";

const STEPS = [
  { title: "Find the moment", body: "We watch Twitch, Kick and YouTube and score the spikes: loud reactions, bursts of chat-worthy speech, scene cuts." },
  { title: "Caption that lands", body: "Word-level timestamps, so every word pops exactly when it's said. Pick Punch, Clean or Neon, or bring your own font." },
  { title: "Post or download", body: "Auto-post where the platform allows it. Everything else is one tap away in the hub." },
];

const RULES = [
  { title: "Automatic where possible.", body: "Clips are found, cut to 9:16 and captioned without you scrubbing a timeline." },
  { title: "Frictionless where necessary.", body: "API quota hit? The clip is already in the hub, ready to download." },
  { title: "Captions that don't drift.", body: "Word timings, not sentence guesses." },
  { title: "Your style, every clip.", body: "Presets for speed, custom fonts for your brand." },
  { title: "Hashtags that are trending now.", body: "This week's TikTok and YouTube tags, one click into the caption." },
  { title: "You stay in control.", body: "Nothing posts that you didn't switch on." },
];

// One wide column for the whole page; sizes only ever grow with the screen.
const COLUMN = "mx-auto w-full max-w-7xl px-4 sm:px-8";

export default function LandingPage() {
  return (
    <div className="bg-paper">
      <header className={`${COLUMN} flex items-center justify-between py-6`}>
        <Logo />
        <nav className="flex items-center gap-2">
          <Button href="/login" variant="ghost">
            Sign in
          </Button>
          <Button href="/register">Get started</Button>
        </nav>
      </header>

      <section className="relative isolate overflow-hidden">
        <AuroraBackground />
        <div className="mx-auto max-w-6xl px-4 pt-20 pb-24 text-center sm:px-8 lg:pt-28 lg:pb-32">
          <Badge tone="brand" size="lg" className="fx-rise bg-surface">
            For stream clippers
          </Badge>
          <h1
            className="fx-rise mt-8 font-display text-5xl leading-[1.05] font-semibold tracking-tight text-balance text-ink md:text-7xl lg:text-8xl"
            style={{ animationDelay: "70ms" }}
          >
            {SITE.tagline}
          </h1>
          <p className="fx-rise mx-auto mt-8 max-w-3xl text-xl text-pretty text-ink-muted lg:text-2xl" style={{ animationDelay: "140ms" }}>
            {SITE.description}
          </p>
          <div className="fx-rise mt-12 flex flex-wrap justify-center gap-4" style={{ animationDelay: "210ms" }}>
            <Button href="/register" size="lg">
              Start clipping <Icon name="arrowRight" />
            </Button>
            <Button href="/login" variant="secondary" size="lg">
              I have an account
            </Button>
          </div>
          <FeatureCloud
            className="mt-16"
            items={["Twitch", "Kick", "YouTube", "Word-level captions", "9:16 auto-crop", "TikTok", "Shorts", "Reels"]}
          />
        </div>
      </section>

      <Tape items={["Watch", "Detect", "Cut", "Caption", "Trend", "Post", "Download"]} />

      <CurveDivider height={96} className="text-surface-sunken" />
      <section className="bg-surface-sunken">
        <div className={`${COLUMN} py-20`}>
          <RevealOnScroll>
            <h2 className="max-w-3xl font-display text-4xl leading-tight font-semibold tracking-tight text-ink lg:text-6xl">
              From a ten-hour stream to a post in three steps.
            </h2>
          </RevealOnScroll>
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <RevealOnScroll key={step.title} delay={i * 90}>
                <Panel padding="lg" className="h-full">
                  <span className="grid size-14 place-items-center rounded-full bg-brand-subtle font-display text-2xl font-semibold text-brand-strong">{i + 1}</span>
                  <h3 className="mt-6 font-display text-2xl font-semibold tracking-tight text-ink lg:text-3xl">{step.title}</h3>
                  <p className="mt-3 text-lg text-ink-muted lg:text-xl">{step.body}</p>
                </Panel>
              </RevealOnScroll>
            ))}
          </div>
        </div>
      </section>
      <CurveDivider flip height={96} className="text-surface-sunken" />

      <section className={`${COLUMN} py-20`}>
        <RuleWall rules={RULES} />
      </section>

      <section className={`${COLUMN} pb-24`}>
        <RevealOnScroll>
          <Panel tone="brand" padding="lg" className="relative isolate overflow-hidden py-16 text-center lg:py-24">
            <AuroraBackground />
            <h2 className="font-display text-4xl font-semibold tracking-tight text-ink lg:text-6xl">Stop scrubbing timelines.</h2>
            <p className="mx-auto mt-5 max-w-2xl text-xl text-ink-muted lg:text-2xl">Add a streamer and let the clips come to you.</p>
            <Button href="/register" size="lg" className="mt-10">
              Get started free
            </Button>
          </Panel>
        </RevealOnScroll>
      </section>

      <footer className="border-t border-line">
        <div className={`${COLUMN} flex flex-col gap-2 py-10 text-base text-ink-muted sm:flex-row sm:justify-between`}>
          <span>© {new Date().getFullYear()} {SITE.name}</span>
          <span>Automatic where possible, frictionless where necessary.</span>
        </div>
      </footer>
    </div>
  );
}
