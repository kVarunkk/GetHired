"use client";

import { createClient } from "@/lib/supabase/client";
import { FormEvent, useState } from "react";
import toast from "react-hot-toast";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Loader2, Pencil, Trash } from "lucide-react";
import { Input } from "./ui/input";
import { IBookmark, IResume, IResumeReview } from "@/lib/types";

interface FormField {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
}

type Item = IResume | IResumeReview | IBookmark;

interface DynamicActionsProps<T extends Item> {
  tableName: string;
  item: T;
  fields: FormField[];
  updateLocalItem: (updatedItem: T) => void;
  removeLocalItem: (id: string) => void;
  entityName?: string;
  identifierKey?: keyof T;
}

export default function DynamicActions<T extends Item>({
  tableName,
  item,
  fields,
  updateLocalItem,
  removeLocalItem,
  entityName = "Item",
  identifierKey = "id",
}: DynamicActionsProps<T>) {
  const [formLoading, setFormLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [openDialog, setOpenDialog] = useState(false);
  const [dialogView, setDialogView] = useState<"edit" | "delete">("edit");

  const supabase = createClient();

  const idKey = (identifierKey ?? "id") as keyof Item;
  const itemId = String(item[idKey]);

  // --- UPDATE LOGIC ---
  const handleUpdate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormLoading(true);

    try {
      const formData = new FormData(e.currentTarget);
      const updates: Record<string, string> = {};

      fields.forEach((field) => {
        const value = formData.get(field.name);
        if (value !== null) {
          updates[field.name] = String(value);
        }
      });

      const { data, error } = await supabase
        .from(tableName)
        .update(updates)
        .eq(String(idKey), itemId)
        .select("*")
        .single();

      if (error) throw error;

      updateLocalItem(data);
      toast.success(`${entityName} updated successfully`);
      setOpenDialog(false);
    } catch (err) {
      console.error(`Update error [${tableName}]:`, err);
      toast.error(`Error updating ${entityName.toLowerCase()}`);
    } finally {
      setFormLoading(false);
    }
  };

  // --- DELETE LOGIC ---
  const handleDelete = async () => {
    setDeleteLoading(true);
    try {
      const { error } = await supabase
        .from(tableName)
        .delete()
        .eq(String(idKey), itemId);

      if (error) throw error;

      removeLocalItem(itemId);
      toast.success(`${entityName} removed successfully`);
      setOpenDialog(false);
    } catch (err) {
      console.error(`Delete error [${tableName}]:`, err);
      toast.error("Could not delete. Please try again later.");
    } finally {
      setDeleteLoading(false);
    }
  };

  // Resolve a display name for the dialog title
  const getDisplayName = (): string => {
    if ("name" in item && typeof item.name === "string") return item.name;
    if ("title" in item && typeof item.title === "string") return item.title;
    return itemId || entityName;
  };

  const displayName = getDisplayName();

  // Helper to safely get field value
  const getFieldValue = (fieldName: string): string => {
    const value = item[fieldName as keyof Item];
    return value !== null && value !== undefined ? String(value) : "";
  };

  return (
    <div className="flex items-center gap-1">
      <Dialog open={openDialog} onOpenChange={setOpenDialog}>
        <div className="flex items-center gap-2">
          {/* Edit Trigger */}
          <DialogTrigger asChild>
            <Button
              onClick={() => {
                setDialogView("edit");
                setOpenDialog(true);
              }}
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
            >
              <Pencil className="h-4 w-4 text-muted-foreground" />
            </Button>
          </DialogTrigger>

          {/* Delete Trigger */}
          <DialogTrigger asChild>
            <Button
              onClick={() => {
                setDialogView("delete");
                setOpenDialog(true);
              }}
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
            >
              <Trash className="h-4 w-4" />
            </Button>
          </DialogTrigger>
        </div>

        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="text-wrap text-start">
              {dialogView === "edit" ? "Edit" : "Delete"} &quot;{displayName}
              &quot;
            </DialogTitle>
            {dialogView === "delete" && (
              <DialogDescription className="text-start">
                Are you sure you want to remove this {entityName.toLowerCase()}?
                This action is permanent and cannot be undone.
              </DialogDescription>
            )}
          </DialogHeader>

          {dialogView === "edit" ? (
            <form className="flex flex-col gap-5" onSubmit={handleUpdate}>
              {fields.map((field) => (
                <div key={field.name} className="flex flex-col gap-2">
                  <label htmlFor={field.name}>{field.label}</label>
                  <Input
                    id={field.name}
                    name={field.name}
                    type={field.type || "text"}
                    placeholder={field.placeholder}
                    defaultValue={getFieldValue(field.name)}
                    className="bg-input text-sm h-10 border-zinc-200 dark:border-zinc-800"
                    required={field.required}
                  />
                </div>
              ))}

              <div className="flex justify-end gap-3 mt-4">
                <DialogClose asChild>
                  <Button variant="outline" disabled={formLoading}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button disabled={formLoading} type="submit">
                  {formLoading ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Saving
                    </div>
                  ) : (
                    "Save Changes"
                  )}
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex justify-end gap-3 mt-6">
              <DialogClose asChild>
                <Button variant="outline" disabled={deleteLoading}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                onClick={handleDelete}
                disabled={deleteLoading}
                variant="destructive"
              >
                {deleteLoading ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Deleting
                  </div>
                ) : (
                  "Delete Permanently"
                )}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
