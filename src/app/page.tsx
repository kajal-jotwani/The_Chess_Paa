import Image from "next/image";
import Navbar from "./Navbar";
import HeroSection from "@/Components/sections/HeroSection";
import WelcomeSection from "@/Components/sections/WelcomeSection";

export default function Home() {
  return (
    <>
      <Navbar />
      <HeroSection />
      <WelcomeSection />
    </>

  );
}
