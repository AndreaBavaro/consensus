import { ArrowRight } from 'lucide-react';

const HREF = 'https://straitly.ai/?utm_source=consensus&utm_medium=banner&utm_campaign=powered_by';
const MODELS: { name: string; logo: string }[] = [
  { name: 'Fable 5.1', logo: '/brand/claude.svg' },
  { name: 'Opus 5.5', logo: '/brand/claude.svg' },
  { name: 'GPT 6 Astra', logo: '/brand/openai.svg' },
  { name: 'DeepSeek', logo: '/brand/deepseek.svg' },
  { name: 'GLM', logo: '/brand/zhipu.svg' },
];

/** Always-on "Powered by Straitly" strip. The whole strip is one link. */
export function SponsorStrip() {
  return (
    <a className="sponsor" href={HREF} target="_blank" rel="noopener" aria-label="Powered by Straitly: up to 80% off top AI models">
      <span className="sp-by">
        <span className="sp-pre">Powered by</span>
        <img src="/brand/straitly.svg" alt="" width={16} height={16} />
        <b>Straitly</b>
      </span>
      <span className="sp-mid">
        <span className="sp-offer">Up to 80% off top AI models</span>
        <span className="sp-models">
          {MODELS.map((m) => (
            <span key={m.name} className="sp-model">
              <img src={m.logo} alt="" width={14} height={14} />
              <span className="sp-name">{m.name}</span>
            </span>
          ))}
        </span>
      </span>
      <span className="sp-cta">
        Get API access <ArrowRight size={14} />
      </span>
    </a>
  );
}
