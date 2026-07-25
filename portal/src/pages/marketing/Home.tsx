import { motion, useScroll, useSpring } from "framer-motion";
import { useSmoothScroll } from "../../lib/useSmoothScroll";
import Navbar from "../../components/landing/Navbar";
import Hero from "../../components/landing/Hero";
import TrustMarquee from "../../components/landing/TrustMarquee";
import Pipeline from "../../components/landing/Pipeline";
import Telemetry from "../../components/landing/Telemetry";
import Capabilities from "../../components/landing/Capabilities";
import Platform from "../../components/landing/Platform";
import Footer from "../../components/landing/Footer";

export default function Home() {
  useSmoothScroll();
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 });

  return (
    <div className="ap-page relative min-h-screen overflow-x-hidden selection:bg-[var(--ap-accent-soft)]">
      {/* scroll progress bar */}
      <motion.div
        style={{ scaleX: progress }}
        className="fixed left-0 right-0 top-0 z-[60] h-[3px] origin-left bg-[var(--ap-accent)]"
      />
      <Navbar />
      <main>
        <Hero />
        <TrustMarquee />
        <Pipeline />
        <Telemetry />
        <Capabilities />
        <Platform />
      </main>
      <Footer />
    </div>
  );
}
