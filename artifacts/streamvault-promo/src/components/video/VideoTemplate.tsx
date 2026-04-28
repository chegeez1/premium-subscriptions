import { useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import Scene1Hero from './video_scenes/Scene1Hero';
import Scene2TradingChart from './video_scenes/Scene2TradingChart';
import Scene3Features from './video_scenes/Scene3Features';
import Scene4Pricing from './video_scenes/Scene4Pricing';
import Scene5Testimonials from './video_scenes/Scene5Testimonials';
import Scene6CTA from './video_scenes/Scene6CTA';

export const SCENE_DURATIONS: Record<string, number> = {
  hero: 6000,
  tradingChart: 8000,
  features: 7000,
  pricing: 7000,
  testimonials: 7000,
  cta: 6000,
};

const SCENE_COMPONENTS: Record<string, React.ComponentType> = {
  hero: Scene1Hero,
  tradingChart: Scene2TradingChart,
  features: Scene3Features,
  pricing: Scene4Pricing,
  testimonials: Scene5Testimonials,
  cta: Scene6CTA,
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
