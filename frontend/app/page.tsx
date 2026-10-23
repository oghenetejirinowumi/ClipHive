import { FeatureCloud, HalftoneHorizon, RevealOnScroll, RuleWall, SkyBackground, Tape } from "@/components/effects";
import {
  Button,
  EditorialSection,
  Em,
  Icon,
  Logo,
  QuoteBanner,
  SectionLabel,
  StatStrip,
  ThemeSwitch,
  Timeline,
  ToneSteps,
} from "@/components/ui";
import { SITE } from "@/lib/site";

const STATS = [
  { value: "3", label: "Sources watched: Twitch, Kick, YouTube" },
  { value: "∞", label: "Clips you can generate; only posting is quota-limited" },
  { value: "9:16", label: "Auto-cropped for every vertical feed" },
  { value: "1 tap", label: "From the hub to posted or downloaded" },
];

const PIPELINE = [
  { marker: "Watch", body: "Add a channel. We detect when it goes live, or pull the latest VOD." },
  { marker: "Detect", body: "Loudness spikes, reaction bursts and scene cuts are scored to find the moment." },
  { marker: "Cut", body: "The clip is trimmed and cropped to 9:16 automatically." },
  { marker: "Caption", body: "Word-level timestamps make every word pop exactly when it's said." },
  { marker: "Post", body: "Auto-post where the platform allows. Everything else waits in the hub." },
];

const STYLES = [
  { eyebrow: "Preset", title: "Punch", body: "Bangers, yellow fill, word-pop." },
  { eyebrow: "Preset", title: "Neon", body: "Cyan fill, magenta glow." },
  { eyebrow: "Preset", title: "Clean", body: "White on a soft box, line by line." },
  { eyebrow: "Yours", title: "Your font", body: "Upload a .ttf or .otf and make it brand." },
];

const PLATFORMS = [
  { name: "Twitch", role: "Source" },
  { name: "Kick", role: "Source" },
  { name: "YouTube", role: "Source" },
  { name: "Download", role: "Always available" },
  { name: "TikTok", role: "Destination" },
  { name: "YouTube Shorts", role: "Destination" },
  { name: "Instagram Reels", role: "Destination" },
  { name: "X", role: "Destination" },
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
      {/* Hero: the brand sky, night at the top dissolving into the page. */}
      <section className="relative isolate overflow-hidden">
        <SkyBackground />
        <header className={`${COLUMN} flex items-center justify-between gap-4 py-6`}>
          <Logo inverse />
          <nav className="flex items-center gap-2 sm:gap-3">
            <ThemeSwitch />
            <Button href="/login" variant="ghostInverse" className="hidden sm:inline-flex">
              Sign in
            </Button>
            <Button href="/register" variant="inverse">
              Get started
            </Button>
          </nav>
        </header>

        <div className="mx-auto max-w-6xl px-4 pt-20 pb-16 text-center sm:px-8 lg:pt-32">
          <SectionLabel inverse className="fx-rise">
            For stream clippers
          </SectionLabel>
          <h1
            className="fx-rise mt-8 font-display text-5xl leading-[1.05] font-semibold tracking-tight text-balance text-on-brand md:text-7xl lg:text-8xl"
            style={{ animationDelay: "70ms" }}
          >
            Every stream&apos;s best moments, <Em>captioned</Em> and ready to post.
          </h1>
          <p className="fx-rise mx-auto mt-8 max-w-3xl text-xl text-pretty text-on-brand/85 lg:text-2xl" style={{ animationDelay: "140ms" }}>
            {SITE.description}
          </p>
          <div className="fx-rise mt-12 flex flex-wrap justify-center gap-4" style={{ animationDelay: "210ms" }}>
            <Button href="/register" variant="inverse" size="lg">
              Start clipping <Icon name="arrowRight" />
            </Button>
            <Button href="/login" variant="ghostInverse" size="lg">
              I have an account
            </Button>
          </div>
        </div>

        <div className={`${COLUMN} pt-16 pb-20 lg:pt-28`}>
          <FeatureCloud items={["Twitch", "Kick", "YouTube", "Word-level captions", "9:16 auto-crop", "TikTok", "Shorts", "Reels"]} />
        </div>
      </section>

      <Tape items={["Watch", "Detect", "Cut", "Caption", "Trend", "Post", "Download"]} />

      <div className={`${COLUMN} space-y-28 py-24 lg:space-y-36 lg:py-32`}>
        <RevealOnScroll>
          <EditorialSection
            label="By the numbers"
            title={
              <>
                Fewer hours scrubbing, <Em>more clips posted</Em>
              </>
            }
          >
            <StatStrip stats={STATS} />
          </EditorialSection>
        </RevealOnScroll>

        <RevealOnScroll>
          <EditorialSection
            label="How it works"
            title={
              <>
                From a ten-hour stream to a post in <Em>five moves</Em>
              </>
            }
          >
            <Timeline items={PIPELINE} />
          </EditorialSection>
        </RevealOnScroll>

        <RevealOnScroll>
          <EditorialSection
            label="Caption styles"
            title={
              <>
                Captions with <Em>personality</Em>
              </>
            }
          >
            <ToneSteps steps={STYLES} />
          </EditorialSection>
        </RevealOnScroll>
      </div>

      {/* Every platform, one hub: a halftone planet rising over a grid of platforms. */}
      <section className="overflow-hidden border-y border-line">
        <div className={`${COLUMN} pt-24 text-center lg:pt-32`}>
          <SectionLabel>One network</SectionLabel>
          <h2 className="mt-6 font-display text-5xl font-semibold tracking-tight text-ink lg:text-7xl">
            Every platform.
            <span className="block text-ink-faint">One hub.</span>
          </h2>
        </div>
        <HalftoneHorizon className="mt-10 h-[22rem] w-full lg:mt-16 lg:h-[30rem]" />
        <div className={`${COLUMN} pb-24 lg:pb-32`}>
          <ul className="grid grid-cols-2 border-t border-l border-line sm:grid-cols-4">
            {PLATFORMS.map((p) => (
              <li key={p.name} className="flex min-h-36 flex-col justify-between gap-6 border-r border-b border-line p-6 lg:min-h-44 lg:p-8">
                <span className="font-mono text-meta tracking-[0.16em] text-ink-muted uppercase">{p.role}</span>
                <span className="font-display text-2xl font-semibold tracking-tight text-ink lg:text-3xl">{p.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div className={`${COLUMN} space-y-28 py-24 lg:space-y-36 lg:py-32`}>
        <EditorialSection
          label="Principles"
          title={
            <>
              Built the way <Em>clippers</Em> actually work
            </>
          }
        >
          <RuleWall rules={RULES} />
        </EditorialSection>

        <RevealOnScroll>
          <QuoteBanner
            quote={
              <>
                &ldquo;Generation is unlimited. Distribution is platform-gated. So we auto-post what the APIs allow, and{" "}
                <Em>everything else is one tap away</Em>.&rdquo;
              </>
            }
            attribution="How ClipHive thinks about quotas"
            action={
              <Button href="/register" variant="inverse" size="lg">
                Get started free <Icon name="arrowRight" />
              </Button>
            }
          />
        </RevealOnScroll>
      </div>

      <footer className="border-t border-line">
        <div className={`${COLUMN} flex flex-col gap-6 py-12 sm:flex-row sm:items-center sm:justify-between`}>
          <Logo />
          <span className="text-lg text-ink-muted">
            © {new Date().getFullYear()} {SITE.name}. Automatic where possible, <Em>frictionless where necessary</Em>.
          </span>
        </div>
      </footer>
    </div>
  );
}
