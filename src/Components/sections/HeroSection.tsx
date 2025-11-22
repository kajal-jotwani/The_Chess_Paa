import Image from "next/image";

export default function HeroSection() {
  return (
    <main className="pt-32">
        <Image
          src="/LandingPage.png"
          alt="Landing Page"
          width={1000}
          height={900}
          className="w-[80%] h-[80%] mx-auto rounded-xl object-cover"
          priority
        />
      </main>
  );
}