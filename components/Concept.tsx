const stages = [
  { title: 'Hands', eq: 'P(x, y, t)', desc: 'The camera tracks 21 landmarks per hand. Thumb and index distance, relative to hand size, defines a pinch.' },
  { title: 'Strings', eq: 'L = |P₂ − P₁|', desc: 'Pinch and pull apart to draw a string between two points. Its length is a physical length in metres.' },
  { title: 'Motion', eq: 'yₜₜ = c² yₓₓ', desc: 'A fingertip crossing the string displaces it. The wave equation carries that displacement between the fixed ends.' },
  { title: 'Sound', eq: 'f₀ = √(T/μ) / 2L', desc: 'The vibrating string is the oscillator. Length, tension and density set the pitch — no samples, no presets.' },
];

export default function Concept() {
  return (
    <section id="concept" data-scene="concept" className="relative min-h-[100svh] px-5 sm:px-8 md:px-20 py-28 flex flex-col justify-center">
      <p data-reveal className="font-mono-math text-[11px] tracking-[0.3em] mb-4" style={{ color: 'var(--accent)' }}>02 / THE CONCEPT</p>
      <h2 data-reveal="split" className="font-semibold leading-tight max-w-3xl" style={{ fontSize: 'clamp(2rem, 5vw, 4rem)', color: 'var(--text-1)' }} dangerouslySetInnerHTML={{ __html: 'One thread, from your hand to the air.' }} />

      <ol className="mt-20 grid grid-cols-1 md:grid-cols-4 gap-14 md:gap-8">
        {stages.map((s, k) => (
          <li key={s.title} className="relative">
            {/* The stage threads a single line through these four nodes. */}
            <span data-anchor={`concept-${k}`} data-on="0" className="concept-node block w-3 h-3 rounded-full mb-8" />
            <p className="font-mono-math text-[11px] mb-2" style={{ color: 'var(--text-3)' }}>0{k + 1}</p>
            <h3 className="text-2xl font-semibold mb-3" style={{ color: 'var(--text-1)' }}>{s.title}</h3>
            <p className="font-mono-math text-sm mb-4" style={{ color: 'var(--accent)' }}>{s.eq}</p>
            <p className="text-sm leading-relaxed max-w-xs" style={{ color: 'var(--text-2)' }}>{s.desc}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
