import Navbar from "@/Components/Navbar";
import ParkSection from "@/Components/sections/ParkSection";
import WelcomeSection from "@/Components/sections/WelcomeSection";
import AdventureZones from "@/Components/sections/AdventureZone";
import Footer from "@/Components/Footer";

/**
 * The original flat storybook landing page, kept at /classic.
 * The front door is now the real 3D park.
 */
export default function ClassicHome() {
  return (
    <>
      <Navbar />
      <ParkSection />
      <WelcomeSection />
      <AdventureZones />
      <Footer />
    </>
  );
}
