import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

const Button: React.FC<ButtonProps> = ({ 
  variant = 'primary', 
  size = 'md', 
  className = '', 
  children, 
  ...props 
}) => {
  const baseStyles = "font-display font-bold rounded-full transition-all duration-200 active:scale-95 shadow-soft flex items-center justify-center gap-2";
  
  const variants = {
    primary: "bg-chess-coral text-white hover:bg-opacity-90 hover:-translate-y-1 shadow-md hover:shadow-lg",
    secondary: "bg-chess-gold text-chess-brown hover:bg-opacity-90 hover:-translate-y-1 shadow-md hover:shadow-lg",
    outline: "border-2 border-chess-brown text-chess-brown hover:bg-chess-brown hover:text-white"
  };

  const sizes = {
    sm: "px-4 py-2 text-sm",
    md: "px-6 py-3 text-base",
    lg: "px-8 py-4 text-xl"
  };

  return (
    <button 
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};

export default Button;