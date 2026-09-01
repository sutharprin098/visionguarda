import React, { useEffect, useRef } from "react";
import * as THREE from "three";

export default function Hero3DCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Performance check: skip 3D canvas if reduced motion or low-power mode
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const container = containerRef.current;
    const width = container.clientWidth || window.innerWidth || 300;
    const height = container.clientHeight || window.innerHeight || 300;

    let scene: THREE.Scene;
    let camera: THREE.PerspectiveCamera;
    let renderer: THREE.WebGLRenderer;

    try {
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
      camera.position.set(0, 1, 11);

      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: "high-performance" });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
      container.appendChild(renderer.domElement);
    } catch (e) {
      console.warn("WebGL initialization skipped:", e);
      return;
    }

    // Optimized Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.8);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0x38bdf8, 1.2);
    sunLight.position.set(5, 10, 5);
    scene.add(sunLight);

    // Lightweight Lambert Material
    const cloudMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      emissive: 0xe0f2fe,
      emissiveIntensity: 0.25,
      transparent: true,
      opacity: 0.7,
    });

    const sharedSphereGeo = new THREE.SphereGeometry(1, 8, 8); // Shared low-poly geometry

    const cloudsGroup = new THREE.Group();

    const createSingleCloudCluster = (x: number, y: number, z: number, scale: number) => {
      const cluster = new THREE.Group();
      const numPuffs = 6; // Reduced count for maximum FPS

      for (let i = 0; i < numPuffs; i++) {
        const puff = new THREE.Mesh(sharedSphereGeo, cloudMaterial);
        const radius = (0.7 + (i % 3) * 0.3) * scale;
        puff.scale.set(radius, radius * 0.7, radius);

        puff.position.set(
          (i === 0 ? 0 : (i % 2 === 0 ? 1 : -1) * 1.2) * scale,
          ((i % 3) * 0.4 - 0.4) * scale,
          ((i % 4) * 0.3 - 0.4) * scale
        );

        cluster.add(puff);
      }

      cluster.position.set(x, y, z);
      return cluster;
    };

    // 5 Optimized Cloud Clusters
    const cloudPositions = [
      { x: -8, y: 3.0, z: -4, scale: 1.3 },
      { x: 7, y: 3.5, z: -5, scale: 1.5 },
      { x: -4, y: 0.8, z: -2, scale: 1.1 },
      { x: 5, y: -0.8, z: -1, scale: 1.2 },
      { x: 0, y: 4.2, z: -7, scale: 1.8 },
    ];

    const cloudMeshList: THREE.Group[] = [];

    cloudPositions.forEach((pos) => {
      const cloud = createSingleCloudCluster(pos.x, pos.y, pos.z, pos.scale);
      cloudsGroup.add(cloud);
      cloudMeshList.push(cloud);
    });

    scene.add(cloudsGroup);

    // Drifting Particles (Reduced count for smooth 60fps)
    const particleCount = 250;
    const particlePositions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      particlePositions[i * 3] = (Math.random() - 0.5) * 24;
      particlePositions[i * 3 + 1] = (Math.random() - 0.5) * 16;
      particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 12;
    }

    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));

    const particleMat = new THREE.PointsMaterial({
      size: 0.05,
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.45,
    });

    const sparkles = new THREE.Points(particleGeo, particleMat);
    scene.add(sparkles);

    // Animation Loop with Visibility Control (IntersectionObserver)
    let animationFrameId: number;
    let isVisible = true;
    const clock = new THREE.Clock();

    const animate = () => {
      if (!isVisible) return;

      const elapsed = clock.getElapsedTime();

      cloudMeshList.forEach((cloud, idx) => {
        cloud.position.y += Math.sin(elapsed * 0.5 + idx) * 0.0015;
        cloud.position.x += Math.cos(elapsed * 0.3 + idx) * 0.001;
      });

      sparkles.rotation.y = elapsed * 0.015;

      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };

    // Pause WebGL rendering completely when Hero section is out of viewport
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        isVisible = entry.isIntersecting;
        if (isVisible) {
          cancelAnimationFrame(animationFrameId);
          animate();
        }
      },
      { threshold: 0.05 }
    );

    observer.observe(container);
    animate();

    // Handle Window Resize
    const handleResize = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationFrameId);
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      sharedSphereGeo.dispose();
      cloudMaterial.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none z-0 overflow-hidden opacity-80"
    />
  );
}
