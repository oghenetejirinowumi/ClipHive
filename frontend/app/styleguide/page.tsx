import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuroraBackground, CurveDivider, FeatureCloud, HalftoneHorizon, RuleWall, SkyBackground, Tape } from "@/components/effects";
import {
  Badge,
  Button,
  EditorialSection,
  Em,
  Field,
  Ledger,
  Logo,
  PageHeader,
  Panel,
  QuoteBanner,
  SectionLabel,
  StatStrip,
  ThemeSwitch,
  Timeline,
} from "@/components/ui";
import { cssVars } from "@/lib/cn";
import { cssVarName, theme } from "@/theme";

export const metadata: Metadata = { title: "Design system" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="font-display text-3xl font-semibold tracking-tight text-ink">{title}</h2>
      {children}
    </section>
  );
}

/** Living reference for every primitive and effect. Public route: /styleguide */
export default function StyleguidePage() {
  return (
    <div className="mx-auto max-w-7xl space-y-16 px-4 py-12 sm:px-8">
      <div className="flex items-center justify-between">
        <Logo />
        <ThemeSwitch size="lg" />
      </div>
      <PageHeader
        eyebrow="Design system"
        title="Calm confidence, alive underneath"
        description="Import primitives from @/components/ui and effects from @/components/effects. Colours come only from the role tokens below."
        actions={<Button variant="secondary">Action</Button>}
      />

      <Section title="Colour roles">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.keys(theme.colors).map((role) => (
            <div key={role} className="overflow-hidden rounded-md border border-line bg-surface">
              <div className="h-20 border-b border-line" style={cssVars({ "--swatch": `var(${cssVarName("colors", role)})` })}>
                <div className="h-full bg-(--swatch)" />
              </div>
              <p className="px-4 py-3 font-mono text-base text-ink-muted">{role}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Delete</Button>
          <Button loading>Saving</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Panels">
        <div className="grid gap-4 sm:grid-cols-3">
          <Panel>Surface</Panel>
          <Panel tone="sunken">Sunken</Panel>
          <Panel tone="brand">Brand</Panel>
        </div>
      </Section>

      <Section title="Badges (status tones are for state only)">
        <div className="flex flex-wrap gap-2">
          <Badge>Draft</Badge>
          <Badge tone="brand">New</Badge>
          <Badge tone="success">Posted</Badge>
          <Badge tone="warning">Processing</Badge>
          <Badge tone="danger">Failed</Badge>
        </div>
      </Section>

      <Section title="Fields">
        <div className="grid max-w-xl gap-6">
          <Field label="Email" placeholder="you@example.com" />
          <Field label="Password" type="password" hint="At least 8 characters." />
          <Field label="Username" error="That username is taken." defaultValue="clipper" />
        </div>
      </Section>

      <Section title="Ledger">
        <Panel>
          <Ledger
            items={[
              { label: "Platform", value: "Twitch" },
              { label: "Clips today", value: "12" },
              { label: "Caption style", value: "Punch", hint: "Bangers, word-pop" },
            ]}
          />
        </Panel>
      </Section>

      <Section title="Editorial">
        <SectionLabel>Section label</SectionLabel>
        <EditorialSection label="Editorial section" title={<>Headlines with <Em>emphasis</Em></>}>
          <StatStrip stats={[{ value: "92%", label: "Stat strip" }, { value: "4,000", label: "Big numbers" }, { value: "11", label: "Hairlines" }, { value: "38", label: "Wraps on phones" }]} />
        </EditorialSection>
        <Timeline items={[{ marker: "01", title: "Timeline", body: "Oversized markers." }, { marker: "02", body: "The last one is lit." }]} />
        <QuoteBanner quote={<>A full-bleed brand block for <Em>one big statement</Em>.</>} attribution="QuoteBanner" action={<Button variant="inverse">Inverse button</Button>} />
      </Section>

      <Section title="Sky & horizon">
        <div className="relative isolate overflow-hidden rounded-xl px-10 pt-12 pb-40">
          <SkyBackground />
          <SectionLabel inverse>SkyBackground</SectionLabel>
          <p className="mt-4 font-display text-5xl font-semibold tracking-tight text-on-brand">Night to <Em>day</Em></p>
          <div className="mt-8 flex gap-3">
            <Button variant="inverse">Inverse</Button>
            <Button variant="ghostInverse">Ghost inverse</Button>
          </div>
        </div>
        <HalftoneHorizon className="h-80 w-full" />
      </Section>

      <Section title="Effects">
        <div className="relative isolate h-96 overflow-hidden rounded-xl bg-brand-subtle">
          <AuroraBackground />
          <div className="grid h-full place-items-center">
            <FeatureCloud items={["Aurora", "Feature cloud", "Floating chips"]} />
          </div>
        </div>
        <Tape items={["Scrolling", "tape", "marquee"]} />
        <RuleWall rules={[{ title: "Sticker card", body: "Tilted, straightens on hover." }, { title: "Rule wall" }, { title: "Reveal on scroll" }]} />
        <div>
          <CurveDivider className="text-surface-sunken" />
          <div className="h-10 bg-surface-sunken" />
        </div>
      </Section>
    </div>
  );
}
