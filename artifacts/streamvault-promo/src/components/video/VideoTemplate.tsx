import { useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import Scene1Hero from './video_scenes/Scene1Hero';
import SceneAINarrator from './video_scenes/SceneAINarrator';
import Scene2TradingChart from './video_scenes/Scene2TradingChart';
import Scene3FreeTools from './video_scenes/Scene3FreeTools';
import Scene4PremiumAccounts from './video_scenes/Scene4PremiumAccounts';
import SceneAITools from './video_scenes/SceneAITools';
import SceneVPSHosting from './video_scenes/SceneVPSHosting';
import SceneFeatures from './video_scenes/Scene3Features';
import ScenePricing from './video_scenes/Scene4Pricing';
import SceneTestimonials from './video_scenes/Scene5Testimonials';
import SceneLinkShortener from './video_scenes/SceneLinkShortener';
import SceneCardTools from './video_scenes/SceneCardTools';
import SceneProxies from './video_scenes/SceneProxies';
import SceneDigitalStore from './video_scenes/SceneDigitalStore';
import SceneBotInAction from './video_scenes/SceneBotInAction';
import SceneWhatsAppBot from './video_scenes/SceneWhatsAppBot';
import SceneCTA from './video_scenes/Scene6CTA';

export const SCENE_DURATIONS: Record<string, number> = {
  hero: 7000,
  aiNarrator: 20000,
  tradingChart: 8000,
  freeTools: 7000,
  premiumAccounts: 8000,
  aiTools: 9000,
  vpsHosting: 8000,
  features: 7000,
  pricing: 8000,
  testimonials: 7000,
  linkShortener: 12000,
  cardTools: 11000,
  proxies: 11000,
  digitalStore: 10000,
  botInAction: 12000,
  whatsappBot: 13000,
  cta: 7000,
};

const SCENE_COMPONENTS: Record<string, React.ComponentType> = {
  hero: Scene1Hero,
  aiNarrator: SceneAINarrator,
  tradingChart: Scene2TradingChart,
  freeTools: Scene3FreeTools,
  premiumAccounts: Scene4PremiumAccounts,
  aiTools: SceneAITools,
  vpsHosting: SceneVPSHosting,
  features: SceneFeatures,
  pricing: ScenePricing,
  testimonials: SceneTestimonials,
  linkShortener: SceneLinkShortener,
  cardTools: SceneCardTools,
  proxies: SceneProxies,
  digitalStore: SceneDigitalStore,
  botInAction: SceneBotInAction,
  whatsappBot: SceneWhatsAppBot,
  cta: SceneCTA,
};

export default function VideoTemplate({
  durations = SCENE_DURATIONS,
  loop = true,
  onSceneChange,
}: {
  durations?: Record<string, number>;
  loop?: boolean;
  onSceneChange?: (sceneKey: string) => void;
} = {}) {
  const { currentSceneKey } = useVideoPlayer({ durations, loop });

  useEffect(() => {
    onSceneChange?.(currentSceneKey);
  }, [currentSceneKey, onSceneChange]);

  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '') as keyof typeof SCENE_DURATIONS;
  const SceneComponent = SCENE_COMPONENTS[baseSceneKey];

  return (
    <div
      className="w-full h-screen overflow-hidden relative"
      style={{ backgroundColor: '#0a0a0a' }}
    >
      <AnimatePresence mode="popLayout">
        {SceneComponent && <SceneComponent key={currentSceneKey} />}
      </AnimatePresence>
    </div>
  );
}
