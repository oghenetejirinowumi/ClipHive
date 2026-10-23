import { AuroraBackground, FeatureCloud, HalftoneHorizon, RevealOnScroll, RuleWall, SkyBackground, Tape } from "@/components/effects";
import { FanOut } from "@/components/marketing/FanOut";
import { StyleShowcase } from "@/components/marketing/StyleShowcase";
import {
  Button,
  EditorialSection,
  Em,
  Icon,
  Logo,
  SectionLabel,
  StatStrip,
  ThemeSwitch,
  Timeline,
} from "@/components/ui";
import { SITE } from "@/lib/site";

const STATS = [
  { value: "3", label: "Sources watched: Twitch, Kick, YouTube" },
  { value: "∞", label: "Clips you can generate; only posting is quota-limited" },
  { value: "9:16", label: "Auto-cropped for every vertical feed" },
  { value: "1 tap", label: "From the hub to posted or downloaded" },
];

// One stream fans out into many clips, many caption variations and many posts.
const PIPELINE = [
  { marker: "Watch", body: "Add your channels. Every live stream and VOD is picked up automatically." },
  { marker: "Detect", body: "One stream yields dozens of moments: reactions, clutch plays, hot takes, each scored and ranked." },
  { marker: "Cut", body: "Every moment becomes its own 9:16 clip, not just the single best one." },
  { marker: "Caption", body: "Render each clip in different caption styles and keep the variation that hits." },
  { marker: "Post", body: "Send every clip to every feed you use. Whatever a platform won't take waits in the hub." },
];

const RULES = [
  { title: "Post right up to the limit.", body: "Clips are found, cut and captioned for you, then auto-posted as far as each platform allows." },
  { title: "Nothing gets stuck.", body: "API quota hit? The clip is already in the hub, ready to download." },
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
            For clippers
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
            title={
              <>
                One ten-hour stream, <Em>dozens of posts</Em>
              </>
            }
          >
            <Timeline items={PIPELINE} />
          </EditorialSection>
        </RevealOnScroll>

        <RevealOnScroll>
          <EditorialSection
            title={
              <>
                Captions with <Em>personality</Em>
              </>
            }
          >
            <StyleShowcase />
          </EditorialSection>
        </RevealOnScroll>
      </div>

      {/* Every platform, one hub: a halftone planet, then every source fanning out to every destination. */}
      <section className="overflow-hidden border-y border-line">
        <div className={`${COLUMN} pt-24 text-center lg:pt-32`}>
          <h2 className="font-display text-5xl font-semibold tracking-tight text-ink lg:text-7xl">
            Every platform.
            <span className="block text-ink-faint">One hub.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-xl text-ink-muted lg:text-2xl">Each stream you watch feeds every destination you post to.</p>
        </div>
        <HalftoneHorizon className="mt-10 h-[22rem] w-full lg:mt-14 lg:h-[28rem]" />
        <div className={`${COLUMN} pb-24 lg:pb-32`}>
          <FanOut />
        </div>
      </section>

      <div className={`${COLUMN} space-y-28 py-24 lg:space-y-36 lg:py-32`}>
        <EditorialSection
          title={
            <>
              Built the way <Em>clippers</Em> actually work
            </>
          }
        >
          <RuleWall rules={RULES} />
        </EditorialSection>

        {/* Closing statement: big, centred, one idea. */}
        <RevealOnScroll>
          <section className="relative isolate overflow-hidden rounded-xl bg-brand px-8 py-20 text-center text-on-brand shadow-glow-strong lg:px-16 lg:py-32">
            <AuroraBackground />
            <h2 className="mx-auto max-w-6xl font-display text-5xl leading-[1.02] font-semibold tracking-tight text-balance md:text-7xl lg:text-8xl">
              Unlimited clips.
              <span className="block">
                <Em>Every feed, maxed out.</Em>
              </span>
            </h2>
            <p className="mx-auto mt-8 max-w-3xl text-xl text-pretty text-on-brand/85 lg:text-2xl">
              We auto-post right up to each platform&apos;s limit. Anything past it waits in the hub, one tap from downloaded.
            </p>
            <div className="mt-12 flex flex-wrap justify-center gap-4">
              <Button href="/register" variant="inverse" size="lg">
                Get started free <Icon name="arrowRight" />
              </Button>
              <Button href="/login" variant="ghostInverse" size="lg">
                Sign in
              </Button>
            </div>
          </section>
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
