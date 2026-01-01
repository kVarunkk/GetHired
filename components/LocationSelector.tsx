"use client";

import { useEffect, useMemo, useState } from "react";
import VirtualizedSelect from "./VirtualizedSelect";
import { ICountry } from "@/lib/types";
import useSWR from "swr";
import { fetcher } from "@/lib/utils";

interface LocationSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

export function LocationSelector({ value, onChange }: LocationSelectorProps) {
  const [cities, setCities] = useState<string[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<string>("");
  const [selectedCity, setSelectedCity] = useState<string>("");

  const {
    data: countriesData,
    error: countriesError,
    isLoading,
  } = useSWR(`/api/locations`, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    staleTime: 5 * 60 * 1000,
  });

  const countries: ICountry[] = useMemo(
    () => (countriesData && !countriesError ? countriesData.data : []),
    [countriesData, countriesError]
  );

  useEffect(() => {
    if (value) {
      const parts = value.split(", ");
      if (parts.length === 2) {
        setSelectedCity(parts[0]);
        setSelectedCountry(parts[1]);
      }
    }
  }, [value]);

  useEffect(() => {
    if (selectedCountry && Array.isArray(countries)) {
      const countryData = countries.find((c) => c.country === selectedCountry);
      setCities(countryData?.cities || []);
    } else {
      setCities([]);
    }
  }, [selectedCountry, countries]);

  useEffect(() => {
    if (selectedCity && selectedCountry) {
      onChange(`${selectedCity}, ${selectedCountry}`);
    } else {
      onChange("");
    }
  }, [selectedCity, selectedCountry, onChange]);

  const handleCountryChange = (country: string) => {
    setSelectedCountry(country);
    setSelectedCity("");
  };

  const handleCityChange = (city: string) => {
    setSelectedCity(city);
  };

  return (
    <div className="flex gap-4">
      <div className="relative flex-1">
        <VirtualizedSelect
          items={countries?.map((each) => each.country) ?? []}
          selectedItem={selectedCountry}
          handleItemChange={(value) => handleCountryChange(value)}
          isLoading={isLoading}
          placeholder="Select Country"
        />
      </div>

      {/* City Selector */}
      <div className="relative flex-1">
        <VirtualizedSelect
          items={cities}
          selectedItem={selectedCity}
          handleItemChange={(value) => handleCityChange(value)}
          isLoading={false}
          placeholder="Select City"
        />
      </div>
    </div>
  );
}
