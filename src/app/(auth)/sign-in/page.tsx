import { LoginForm } from "@/app/(auth)/sign-in/login-form"
import Image from "next/image"

export default function LoginPage() {
  return (
    <div className="relative min-h-svh flex flex-col items-center justify-center p-6 md:p-10 overflow-hidden">
      {/* Background image */}
      <div className="absolute inset-0 -z-10">
        <Image
          src="/checkboard.png"
          alt="Checkboard Background"
          fill
          className="object-cover"
          quality={100}
          priority
        />
      </div>

      <div className="w-full max-w-sm md:max-w-4xl relative z-10">
        <LoginForm />
      </div>
    </div>
  )
}
