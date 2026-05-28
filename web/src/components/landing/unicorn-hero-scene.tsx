"use client";

import UnicornScene from "unicornstudio-react/next";

export function UnicornHeroScene() {
  return (
    <UnicornScene
      jsonFilePath="/landing/hero-scene.json"
      sdkUrl="/landing/unicornStudio.umd.js"
      width="100%"
      height="100%"
      scale={1}
      dpi={1.5}
      fps={60}
      lazyLoad={false}
      altText="Animated background"
      ariaLabel="Decorative animated background"
    />
  );
}
