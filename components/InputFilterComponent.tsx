"use client";

import { ChangeEvent, useCallback, useEffect, useState } from "react";
import { Input } from "./ui/input";

export default function InputFilter({
  name,
  value,
  onChange,
  type,
  placeholder,
  min,
  className,
}: {
  name: string;
  value?: string | string[];
  onChange: (name: string, value: string | string[] | undefined) => void;
  type: string;
  className: string;
  placeholder?: string;
  min?: number;
}) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      onChange(name, localValue);
    }, 400);

    return () => clearTimeout(timeoutId);
  }, [localValue, name, onChange]);

  const handleChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);
  }, []);

  return (
    <Input
      id={name}
      name={name}
      type={type}
      placeholder={placeholder}
      value={localValue}
      onChange={handleChange}
      className={className}
      min={min}
    />
  );
}
