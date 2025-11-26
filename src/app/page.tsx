import Image from "next/image";
import Navbar from "@/Components/Navbar";
import HeroSection from "@/Components/sections/HeroSection";
import WelcomeSection from "@/Components/sections/WelcomeSection";
import AdventureZones from "@/Components/sections/AdventureZone";
import Footer from "@/Components/Footer";

export default function Home() {
  return (
    <>
      <Navbar />
      <HeroSection />
      <WelcomeSection />
      <AdventureZones />
      <Footer/>
    </>

  );
}
