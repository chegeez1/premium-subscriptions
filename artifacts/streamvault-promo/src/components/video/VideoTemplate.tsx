import { useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import Scene1Hero from './video_scenes/Scene1Hero';
import Scene2TradingChart from './video_scenes/Scene2TradingChart';
import Scene3FreeTools from './video_scenes/Scene3FreeTools';
import Scene4PremiumAccounts from './video_scenes/Scene4PremiumAccounts';
import Scene5Features from './video_scenes/Scene3Features';
import Scene6Pricing from './video_scenes/Scene4Pricing';
import Scene7Testimonials from './video_scenes/Scene5Testimonials';
import Scene8CTA from './video_scenes/Scene6CTA';

export const SCENE_DURATIONS: Record<string, number> = {
  hero: 6000,
  tradingChart: 8000,
  freeTools: 7000,
  premiumAccounts: 8000,
  features: 7000,
  pricing: 7000,
  testimonials: 7000,
  cta: 6000,
};

const SCENE_COMPONENTS: Record<string, React.ComponentType> = {
  hero: Scene1Hero,
  tradingChart: Scene2TradingChart,
  freeTools: Scene3FreeTools,
  premiumAccounts: Scene4PremiumAccounts,
  features: Scene5Features,
  pricing: Scene6Pricing,
  testimonials: Scene7Testimonials,
  cta: Scene8CTA,
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
