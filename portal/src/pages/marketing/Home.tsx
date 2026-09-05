import React from "react";
import { motion, useScroll, useSpring } from "framer-motion";
import { useSmoothScroll } from "../../lib/useSmoothScroll";
import HeroSection from "../../components/landing/HeroSection";
import MobileAppShowcaseSection from "../../components/landing/MobileAppShowcaseSection";
import RealtimeAlertSection from "../../components/landing/RealtimeAlertSection";
import CameraNetworkSection from "../../components/landing/CameraNetworkSection";
import AIFeaturesGrid from "../../components/landing/AIFeaturesGrid";
import LiveDashboardSection from "../../components/landing/LiveDashboardSection";
import AccuracyReportSection from "../../components/landing/AccuracyReportSection";
import TrustSection from "../../components/landing/TrustSection";

export default function Home() {
  // Inertial smooth scroll via Lenis
  useSmoothScroll();

  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 });

  return (
    <div className="min-h-screen bg-sky-50/50 text-slate-900 overflow-x-hidden selection:bg-sky-500/30">
      {/* Glowing Light Top Scroll Progress Bar */}
      <motion.div
        style={{ scaleX }}
        className="fixed top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-600 z-[100] origin-left shadow-[0_0_15px_rgba(14,165,233,0.6)]"
      />

      {/* Main Content Sections with Ultra-Smooth Light Cloud Transitions */}
      <main className="relative z-10 bg-sky-50/50">
        <HeroSection />
        <MobileAppShowcaseSection />
        <RealtimeAlertSection />
        <CameraNetworkSection />
        <AIFeaturesGrid />
        <LiveDashboardSection />
        <AccuracyReportSection />
        <TrustSection />
      </main>
    </div>
  );
}
