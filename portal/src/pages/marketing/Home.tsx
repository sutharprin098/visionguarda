import React from "react";
import { motion, useScroll, useSpring } from "framer-motion";
import { useSmoothScroll } from "../../lib/useSmoothScroll";
import HeroSection from "../../components/landing/HeroSection";
import MobileAppShowcaseSection from "../../components/landing/MobileAppShowcaseSection";
import RealtimeAlertSection from "../../components/landing/RealtimeAlertSection";
import CameraNetworkSection from "../../components/landing/CameraNetworkSection";
import AIFeaturesGrid from "../../components/landing/AIFeaturesGrid";
import LiveDashboardSection from "../../components/landing/LiveDashboardSection";
import TrustSection from "../../components/landing/TrustSection";

export default function Home() {
  // Inertial smooth scroll via Lenis
  useSmoothScroll();

  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 });

  return (
    <div className="ap-page min-h-screen overflow-x-hidden selection:bg-[var(--ap-accent-soft)]">
      {/* Top Scroll Progress Bar */}
      <motion.div
        style={{ scaleX }}
        className="fixed top-0 left-0 right-0 h-[3px] bg-[var(--ap-accent)] z-[60] origin-left shadow-sm"
      />

      {/* Main Content Sections */}
      <main className="relative">
        <HeroSection />
        <MobileAppShowcaseSection />
        <RealtimeAlertSection />
        <CameraNetworkSection />
        <AIFeaturesGrid />
        <LiveDashboardSection />
        <TrustSection />
      </main>
    </div>
  );
}
