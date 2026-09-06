import { Link } from "wouter";
import {
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  Calculator,
  Check,
  Compass,
  Landmark,
  LineChart,
  Mail,
  MessageSquareHeart,
  PiggyBank,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { Button } from "@workspace/wealthone-design-system/components/ui/button";
import { Card, CardContent } from "@workspace/wealthone-design-system/components/ui/card";

const journey = [
  {
    number: "01",
    title: "See the money coming in",
    copy: "Record salary, business income and other sources so your plan begins with a dependable view of take-home cash flow.",
    action: "Record income",
    href: "/income",
    icon: Wallet,
  },
  {
    number: "02",
    title: "Understand where it goes",
    copy: "Bring everyday spending, budgets and EMIs together. The goal is not perfect tracking—it is a useful monthly baseline.",
    action: "Review your dashboard",
    href: "/",
    icon: ReceiptText,
  },
  {
    number: "03",
    title: "Connect the assets you are building",
    copy: "Add investments already working for you, from EPF and PPF to funds, deposits and other long-term holdings.",
    action: "Add investments",
    href: "/investments",
    icon: PiggyBank,
  },
  {
    number: "04",
    title: "Turn today into a longer view",
    copy: "Review retirement readiness, adjust assumptions and revisit the plan as income, obligations and priorities change.",
    action: "Explore retirement",
    href: "/retirement",
    icon: Compass,
  },
];

const capabilities = [
  { title: "Budgeting", copy: "Set practical category limits and compare them with recorded spending.", icon: BarChart3 },
  { title: "Tax awareness", copy: "Keep income and tax context together for a clearer view of take-home money.", icon: Calculator },
  { title: "Investments", copy: "Track holdings, contributions and the assets supporting your future plan.", icon: PiggyBank },
  { title: "Loans", copy: "See EMIs, outstanding obligations and when committed cash flow may be released.", icon: Landmark },
  { title: "Trends", copy: "Notice patterns over time instead of making decisions from a single month.", icon: LineChart },
  { title: "Advice", copy: "Get contextual prompts that help you identify useful areas to review.", icon: MessageSquareHeart },
  { title: "Retirement planning", copy: "Connect cash flow, investments and assumptions in one forward-looking estimate.", icon: BriefcaseBusiness },
];

const principles = [
  "Your information forms one connected plan, not a collection of isolated totals.",
  "You can adjust assumptions and decide which actions make sense for your life.",
  "The plan is designed to be revisited as circumstances and priorities change.",
];

const contactOptions = [
  {
    address: "hello@ezyretire.com",
    title: "Personal assistance",
    copy: "For help getting started or a personal conversation with our team.",
  },
  {
    address: "support@ezyretire.com",
    title: "Product support",
    copy: "For help using ezyRetire or resolving an issue.",
  },
  {
    address: "feedback@ezyretire.com",
    title: "Feedback",
    copy: "For ideas and suggestions that can make ezyRetire better.",
  },
  {
    address: "info@ezyretire.com",
    title: "General information",
    copy: "For general questions about ezyRetire.",
  },
] as const;

export default function About() {
  return (
    <article className="space-y-12 md:space-y-20 pb-8 md:pb-12 animate-in fade-in duration-500" data-testid="page-about">
      <header className="relative isolate overflow-hidden rounded-2xl md:rounded-[2rem] border border-primary/15 bg-card px-4 md:px-6 py-10 md:py-12 shadow-sm sm:px-10 md:py-16 lg:px-16">
        <div className="pointer-events-none absolute -right-24 -top-24 h-48 w-48 md:h-72 md:w-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-48 w-48 md:h-64 md:w-64 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative max-w-3xl">
          <div className="mb-4 md:mb-6 inline-flex items-center gap-1.5 md:gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-[10px] md:text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            <Sparkles className="h-3 w-3 md:h-3.5 md:w-3.5" aria-hidden="true" />
            A living plan for real life
          </div>
          <h1 className="font-serif text-3xl md:text-4xl font-semibold leading-[1.08] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            From scattered financial details to one clear retirement story.
          </h1>
          <p className="mt-4 md:mt-6 max-w-2xl text-sm md:text-base leading-relaxed md:leading-7 text-muted-foreground sm:text-lg">
            ezyRetire brings the decisions you make today—earning, spending, borrowing and investing—into a single view you can understand, refine and return to.
          </p>
          <div className="mt-6 md:mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" data-testid="link-about-dashboard">
              <Link href="/">
                See your full picture <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" data-testid="link-about-retirement-hero">
              <Link href="/retirement">Review retirement readiness</Link>
            </Button>
          </div>
        </div>
      </header>

      <section aria-labelledby="about-story-heading" className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Why ezyRetire exists</p>
          <h2 id="about-story-heading" className="mt-3 font-serif text-3xl font-semibold leading-tight sm:text-4xl">
            Clarity starts before the calculation.
          </h2>
        </div>
        <div className="space-y-4 text-base leading-7 text-muted-foreground">
          <p>
            Financial plans often begin in separate places: a salary statement, an expense list, a loan schedule, an investment app. Each tells part of the truth, but not how the pieces shape the future together.
          </p>
          <p>
            ezyRetire creates that connection. First, build visibility. Then strengthen everyday habits. Finally, see how today’s choices may influence retirement—and keep updating the plan as life changes.
          </p>
        </div>
      </section>

      <section aria-labelledby="about-journey-heading">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">How to start</p>
          <h2 id="about-journey-heading" className="mt-3 font-serif text-3xl font-semibold sm:text-4xl">
            Build your plan in four useful steps.
          </h2>
          <p className="mt-4 leading-7 text-muted-foreground">
            You do not need every detail on day one. Start with the facts you know, then make the picture more useful over time.
          </p>
        </div>
        <ol className="mt-10 grid gap-5 md:grid-cols-2">
          {journey.map((step) => {
            const Icon = step.icon;
            return (
              <li key={step.number}>
                <Card className="group h-full overflow-hidden border-border/70 transition-all duration-300 hover:-translate-y-1 hover:border-primary/25 hover:shadow-lg motion-reduce:transform-none motion-reduce:transition-none">
                  <CardContent className="p-6 sm:p-7">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <span className="font-serif text-3xl text-primary/25" aria-hidden="true">{step.number}</span>
                    </div>
                    <h3 className="mt-6 font-serif text-2xl font-semibold">{step.title}</h3>
                    <p className="mt-3 leading-6 text-muted-foreground">{step.copy}</p>
                    <Link
                      href={step.href}
                      data-testid={`link-about-step-${step.number}`}
                      className="mt-6 inline-flex items-center rounded-sm text-sm font-semibold text-primary outline-none transition-colors hover:text-primary/75 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                      {step.action} <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1 motion-reduce:transform-none" aria-hidden="true" />
                    </Link>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="about-capabilities-heading" className="rounded-2xl md:rounded-[2rem] bg-muted/45 px-4 md:px-5 py-8 md:py-10 sm:px-8 lg:px-10">
        <div className="max-w-2xl">
          <p className="text-[10px] md:text-sm font-semibold uppercase tracking-[0.18em] text-primary">One connected workspace</p>
          <h2 id="about-capabilities-heading" className="mt-2 md:mt-3 font-serif text-2xl md:text-3xl font-semibold sm:text-4xl">
            Every view contributes to the same picture.
          </h2>
        </div>
        <div className="mt-6 md:mt-9 grid gap-x-6 md:gap-x-8 gap-y-5 md:gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((capability) => {
            const Icon = capability.icon;
            return (
              <div key={capability.title} className="flex gap-4">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-card text-primary shadow-sm">
                  <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="font-semibold">{capability.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{capability.copy}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="about-trust-heading" className="grid gap-6 md:gap-8 lg:grid-cols-2">
        <div className="rounded-2xl md:rounded-[2rem] border border-emerald-200/60 bg-emerald-50/60 p-5 md:p-7 dark:border-emerald-900/60 dark:bg-emerald-950/20 sm:p-9">
          <ShieldCheck className="h-6 w-6 md:h-8 md:w-8 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
          <p className="mt-4 md:mt-6 text-[10px] md:text-sm font-semibold uppercase tracking-[0.18em] text-emerald-800 dark:text-emerald-300">
            Professional support
          </p>
          <h2 id="about-trust-heading" className="mt-2 md:mt-3 font-serif text-2xl md:text-3xl font-semibold">
            Move forward with guidance you can trust.
          </h2>
          <p className="mt-3 md:mt-4 text-sm md:text-base leading-relaxed md:leading-7 text-muted-foreground">
            ezyRetire gives you a useful starting point. When you are ready for the next step, we can connect you with the right professional for your needs.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-emerald-200/80 bg-white/70 p-4 dark:border-emerald-900/70 dark:bg-emerald-950/35">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 dark:bg-emerald-900/70 dark:text-emerald-300">
                <BriefcaseBusiness className="h-4.5 w-4.5" aria-hidden="true" />
              </div>
              <h3 className="mt-3 font-semibold">Financial Advisors</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Guidance on financial planning, investments and retirement strategy.
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-200/80 bg-white/70 p-4 dark:border-emerald-900/70 dark:bg-emerald-950/35">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 dark:bg-emerald-900/70 dark:text-emerald-300">
                <Calculator className="h-4.5 w-4.5" aria-hidden="true" />
              </div>
              <h3 className="mt-3 font-semibold">Chartered Accountants (CAs)</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Expertise in income tax, capital gains and financial compliance.
              </p>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Projections are estimates based on the information and assumptions you provide. They are not guarantees, investment recommendations or a substitute for professional financial, tax or legal advice.
          </p>
          <Button asChild className="mt-6" data-testid="link-about-professional-guidance">
            <Link href="/advice">
              Request professional guidance <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
        <div className="p-2 sm:p-6">
          <div className="flex items-center gap-3 text-primary">
            <RefreshCw className="h-6 w-6" aria-hidden="true" />
            <span className="text-sm font-semibold uppercase tracking-[0.18em]">Designed to evolve</span>
          </div>
          <h2 className="mt-5 font-serif text-3xl font-semibold">Your plan should move when life does.</h2>
          <ul className="mt-6 space-y-4">
            {principles.map((principle) => (
              <li key={principle} className="flex gap-3 leading-6 text-muted-foreground">
                <Check className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>{principle}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        aria-labelledby="about-contact-heading"
        className="rounded-2xl border border-border/70 bg-card px-5 py-8 shadow-sm sm:px-8 md:rounded-[2rem] md:px-10 md:py-10"
        data-testid="about-contact"
      >
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Contact us</p>
          <h2 id="about-contact-heading" className="mt-3 font-serif text-2xl font-semibold sm:text-3xl">
            Reach the right team.
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground md:text-base">
            For personal assistance, start with hello@ezyretire.com. We will review your message
            and contact you soon.
          </p>
        </div>
        <div className="mt-7 grid gap-4 sm:grid-cols-2">
          {contactOptions.map((option) => (
            <a
              key={option.address}
              href={`mailto:${option.address}`}
              className="group rounded-xl border border-border/70 p-4 outline-none transition-colors hover:border-primary/30 hover:bg-primary/[0.03] focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              data-testid={`link-contact-${option.address.split("@")[0]}`}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Mail className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold">{option.title}</h3>
                  <p className="mt-1 break-all text-sm font-medium text-primary">{option.address}</p>
                  <p className="mt-2 text-sm leading-5 text-muted-foreground">{option.copy}</p>
                </div>
              </div>
            </a>
          ))}
        </div>
      </section>

      <section aria-labelledby="about-next-heading" className="rounded-2xl md:rounded-[2rem] bg-primary px-5 md:px-6 py-8 md:py-10 text-primary-foreground sm:px-10 sm:py-12">
        <div className="flex flex-col items-start justify-between gap-6 md:gap-8 lg:flex-row lg:items-center">
          <div className="max-w-2xl">
            <h2 id="about-next-heading" className="font-serif text-2xl md:text-3xl font-semibold sm:text-4xl">Start with what you know today.</h2>
            <p className="mt-2 md:mt-3 text-sm md:text-base leading-relaxed md:leading-7 text-primary-foreground/80">
              A useful plan does not have to be complete. Add one reliable source of income, then let the picture grow from there.
            </p>
          </div>
          <Button asChild size="lg" variant="secondary" data-testid="link-about-income-final">
            <Link href="/income">
              Add your income <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </section>
    </article>
  );
}