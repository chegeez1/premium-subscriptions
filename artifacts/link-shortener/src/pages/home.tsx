import React, { useState, useEffect, useRef } from "react";
import { Link as RouterLink, useLocation } from "wouter";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, Link as LinkIcon, Trash2, ArrowRight, BarChart3, TrendingUp, Clock, Check, Plus, ExternalLink } from "lucide-react";
import { format } from "date-fns";

import {
  useListLinks,
  useCreateLink,
  useGetLinkStats,
  useDeleteLink,
  getListLinksQueryKey,
  getGetLinkStatsQueryKey,
} from "@workspace/api-client-react";
import type { Link } from "@workspace/api-client-react/src/generated/api.schemas";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { NavBar } from "@/components/nav-bar";

const createLinkSchema = z.object({
  originalUrl: z.string().url("Please enter a valid URL (e.g. https://example.com)"),
  customSlug: z.string().optional(),
});

type CreateLinkValues = z.infer<typeof createLinkSchema>;

export default function Home() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // Queries
  const { data: links, isLoading: isLinksLoading } = useListLinks({
    query: {
      queryKey: getListLinksQueryKey(),
    }
  });

  const { data: stats, isLoading: isStatsLoading } = useGetLinkStats({
    query: {
      queryKey: getGetLinkStatsQueryKey(),
    }
  });

  // Mutations
  const createLink = useCreateLink();
  const deleteLink = useDeleteLink();

  // Form
  const form = useForm<CreateLinkValues>({
    resolver: zodResolver(createLinkSchema),
    defaultValues: {
      originalUrl: "",
      customSlug: "",
    },
  });

  const onSubmit = (values: CreateLinkValues) => {
    createLink.mutate({ data: values }, {
      onSuccess: () => {
        form.reset();
        toast({
          title: "Link shortened successfully!",
          description: "Your new short link is ready to use.",
        });
        queryClient.invalidateQueries({ queryKey: getListLinksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetLinkStatsQueryKey() });
      },
      onError: (err: any) => {
        toast({
          title: "Error creating link",
          description: err.message || "Failed to create short link.",
          variant: "destructive"
        });
      }
    });
  };

  const handleDelete = (id: number) => {
    deleteLink.mutate({ id }, {
      onSuccess: () => {
        toast({
          title: "Link deleted",
          description: "The short link has been removed.",
        });
        queryClient.invalidateQueries({ queryKey: getListLinksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetLinkStatsQueryKey() });
      },
      onError: (err: any) => {
        toast({
          title: "Error deleting link",
          description: err.message || "Failed to delete link.",
          variant: "destructive"
        });
      }
    });
  };

  const handleCopy = (id: number, slug: string) => {
    const shortUrl = `${window.location.origin}/r/${slug}`;
    navigator.clipboard.writeText(shortUrl).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
      toast({
        title: "Copied!",
        description: "Link copied to clipboard.",
      });
    });
  };

  const getShortUrl = (slug: string) => {
    return `${window.location.origin}/r/${slug}`;
  };

  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center bg-background text-foreground pb-24">
      {/* Header */}
      <NavBar />

      <main className="w-full max-w-5xl px-6 flex flex-col gap-12 mt-8">
        {/* Hero & Form Section */}
        <section className="flex flex-col md:flex-row gap-8 items-start">
          <div className="flex-1 space-y-6">
            <div className="space-y-4">
              <h1 className="text-4xl md:text-6xl font-black tracking-tight text-white leading-tight">
                Shorten. <br className="hidden md:block"/>
                Share. <span className="text-primary">Track.</span>
              </h1>
              <p className="text-muted-foreground text-lg max-w-md">
                The premium URL shortener for affiliates, resellers, and digital creators. Fast, reliable, and beautifully designed.
              </p>
            </div>

            <Card className="border-border bg-card/50 backdrop-blur-xl">
              <CardContent className="pt-6">
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="originalUrl"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground">Original URL</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="https://your-long-url.com/very/long/path" 
                              className="bg-background border-border focus-visible:ring-primary h-12 text-base"
                              data-testid="input-original-url"
                              {...field} 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={form.control}
                      name="customSlug"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground">Custom Slug (Optional)</FormLabel>
                          <FormControl>
                            <div className="flex items-center gap-2">
                              <div className="bg-muted px-3 h-12 rounded-md border border-border flex items-center text-muted-foreground text-sm whitespace-nowrap">
                                {window.location.host}/r/
                              </div>
                              <Input 
                                placeholder="my-custom-link" 
                                className="bg-background border-border focus-visible:ring-primary h-12 text-base flex-1"
                                data-testid="input-custom-slug"
                                {...field} 
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <Button 
                      type="submit" 
                      className="w-full h-12 text-base font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]"
                      disabled={createLink.isPending}
                      data-testid="button-submit"
                    >
                      {createLink.isPending ? "Creating..." : "Shorten URL"}
                      <ArrowRight className="ml-2 h-5 w-5" />
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
          </div>

          {/* Stats Section Sidebar */}
          <div className="w-full md:w-80 flex flex-col gap-4">
            <Card className="bg-card/50 backdrop-blur-xl border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Total Links</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-4xl font-black text-white" data-testid="text-total-links">
                  {isStatsLoading ? <Skeleton className="h-10 w-24" /> : (stats?.totalLinks || 0).toLocaleString()}
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-card/50 backdrop-blur-xl border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Total Clicks</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-4xl font-black text-primary" data-testid="text-total-clicks">
                  {isStatsLoading ? <Skeleton className="h-10 w-24 bg-primary/20" /> : (stats?.totalClicks || 0).toLocaleString()}
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Links List Section */}
        <section className="space-y-6 pt-8 border-t border-border">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <LinkIcon className="h-6 w-6 text-primary" />
              Your Links
            </h2>
          </div>

          <div className="bg-card/50 border border-border rounded-lg overflow-hidden backdrop-blur-xl">
            {isLinksLoading ? (
              <div className="p-8 flex flex-col gap-4">
                <Skeleton className="h-16 w-full rounded-md" />
                <Skeleton className="h-16 w-full rounded-md" />
                <Skeleton className="h-16 w-full rounded-md" />
              </div>
            ) : links && links.length > 0 ? (
              <div className="divide-y divide-border">
                {links.map((link) => (
                  <div key={link.id} className="p-5 flex flex-col sm:flex-row sm:items-center gap-4 hover:bg-muted/50 transition-colors group" data-testid={`row-link-${link.id}`}>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <a 
                          href={getShortUrl(link.slug)} 
                          target="_blank" 
                          rel="noreferrer"
                          className="text-lg font-semibold text-primary hover:underline flex items-center gap-1 truncate"
                          data-testid={`link-short-${link.id}`}
                        >
                          {getShortUrl(link.slug)}
                          <ExternalLink className="h-3.5 w-3.5 opacity-50" />
                        </a>
                      </div>
                      <div className="text-sm text-muted-foreground truncate" title={link.originalUrl} data-testid={`text-original-${link.id}`}>
                        {link.originalUrl}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2">
                        <div className="flex items-center gap-1">
                          <BarChart3 className="h-3.5 w-3.5" />
                          <span className="font-medium text-foreground">{link.clicks.toLocaleString()}</span> clicks
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          <span>{format(new Date(link.createdAt), "MMM d, yyyy")}</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleCopy(link.id, link.slug)}
                        className="font-medium"
                        data-testid={`button-copy-${link.id}`}
                      >
                        {copiedId === link.id ? (
                          <>
                            <Check className="h-4 w-4 mr-2 text-primary" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4 mr-2" />
                            Copy
                          </>
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => handleDelete(link.id)}
                        disabled={deleteLink.isPending}
                        data-testid={`button-delete-${link.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-12 text-center flex flex-col items-center justify-center">
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                  <LinkIcon className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">No links yet</h3>
                <p className="text-muted-foreground max-w-sm mb-6">
                  Shorten your first URL using the form above to start tracking clicks.
                </p>
                <Button 
                  variant="outline" 
                  onClick={() => document.querySelector('input[name="originalUrl"]')?.focus()}
                  data-testid="button-create-first"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create your first link
                </Button>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}