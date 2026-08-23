import Navbar from "@/Components/Navbar";
import ParkSection from "@/Components/sections/ParkSection";
import WelcomeSection from "@/Components/sections/WelcomeSection";
import AdventureZones from "@/Components/sections/AdventureZone";
import Footer from "@/Components/Footer";

export default function Home() {
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
