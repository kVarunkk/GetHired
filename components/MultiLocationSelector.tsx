"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { X, Check } from "lucide-react";
import { cn, fetcher } from "@/lib/utils";
import { ICountry } from "@/lib/types";
import VirtualizedSelect from "./VirtualizedSelect";
import useSWR from "swr";

interface MultiLocationSelectorProps {
  value: string[]; // controlled by RHF
  onChange: (locations: string[]) => void; // RHF setter
  className?: string;
}

export default function MultiLocationSelector({
  value = [],
  onChange,
  className = "",
}: MultiLocationSelectorProps) {
  const [cities, setCities] = useState<string[]>([]);
  const [selectedCountry, setSelectedCountry] = useState("");
  const [selectedCity, setSelectedCity] = useState("");
  const [isRemote, setIsRemote] = useState<"yes" | "no" | "">("");

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

  // Load cities when country changes
  useEffect(() => {
    if (selectedCountry && countries) {
      const countryData = countries.find((c) => c.country === selectedCountry);
      setCities(countryData?.cities || []);
    } else {
      setCities([]);
    }
  }, [selectedCountry, countries]);

  const handleCountryChange = useCallback(
    (country: string) => {
      setSelectedCountry(country);
      setSelectedCity(""); // reset city
    },
    [setSelectedCountry, setSelectedCity]
  );

  const handleCityChange = useCallback((city: string) => {
    setSelectedCity(city);
  }, []);

  const handleRemoteChange = useCallback((value: "yes" | "no") => {
    setIsRemote(value);
  }, []);

  const addCurrentSelection = useCallback(() => {
    const countryData = countries
      ? countries.find((c) => c.country === selectedCountry)
      : undefined;
    let locationString = "";

    if (isRemote === "yes") {
      locationString = selectedCountry
        ? `Remote (${countryData?.iso})`
        : "Remote";
    } else if (selectedCity && selectedCountry) {
      locationString = `${selectedCity} (${countryData?.iso})`;
    } else if (selectedCountry) {
      locationString = selectedCountry;
    }

    if (locationString && !value.includes(locationString)) {
      onChange([...value, locationString]);
      setSelectedCountry("");
      setSelectedCity("");
      setIsRemote("");
    }
  }, [value, onChange, isRemote, selectedCountry, selectedCity, countries]);

  const removeLocation = useCallback(
    (locationToRemove: string) => {
      onChange(value.filter((loc) => loc !== locationToRemove));
    },
    [value, onChange]
  );

  const isSelectionValid = useMemo(() => {
    return isRemote || !!selectedCountry;
  }, [isRemote, selectedCountry]);

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div>
        <div className="flex items-center gap-2 flex-1 flex-wrap">
          {/* Country Dropdown */}
          <div className="relative flex-1">
            <VirtualizedSelect
              items={countries?.map((each) => each.country) ?? []}
              selectedItem={selectedCountry}
              handleItemChange={(value) => handleCountryChange(value)}
              isLoading={isLoading}
              placeholder="Select Country"
            />
          </div>

          {/* City Dropdown */}
          {selectedCountry && (
            <div className="relative flex-1">
              <VirtualizedSelect
                items={cities}
                selectedItem={selectedCity}
                handleItemChange={(value) => handleCityChange(value)}
                isLoading={false}
                placeholder="Select City"
              />
            </div>
          )}

          {/* Remote Dropdown */}
          <div className="relative flex-1">
            <Select onValueChange={handleRemoteChange} value={isRemote}>
              <SelectTrigger className="bg-input ">
                <SelectValue placeholder={"Is Job Remote?"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Yes</SelectItem>
                <SelectItem value="no">No</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Action buttons */}
          {(isRemote || selectedCountry) && (
            <div className="flex items-center text-muted-foreground ">
              <button
                type="button"
                className="p-1 hover:text-primary"
                disabled={!isSelectionValid}
                onClick={() => {
                  setIsRemote("");
                  setSelectedCity("");
                  setSelectedCountry("");
                }}
              >
                <X className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="p-1 hover:text-primary"
                onClick={addCurrentSelection}
              >
                <Check className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Display selected locations */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((content) => (
            <span
              key={content}
              className="flex items-center border border-border px-2 py-1 rounded text-sm"
            >
              {content}
              <button
                type="button"
                onClick={() => removeLocation(content)}
                className="p-1 ml-1"
              >
                <X className="h-4 w-4" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
