
        const query = String(req.query.q || '').trim().slice(0, 64);
        const page = Math.max(1, Math.min(1000000, Number.parseInt(req.query.page, 10) || 1));
        const pageSize = 100;
        let request = db().from('item_usage_events')
            .select('id,steam_id,item_id,item_name,quantity,used_at')
            .order('used_at', { ascending: false }).limit(100);
            .select('id,steam_id,item_id,item_name,quantity,used_at', { count: 'exact' })
            .order('used_at', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
        if (query) {
            const safeQuery = query.replace(/[^\p{L}\p{N}_ -]/gu, '').trim();
            if (!safeQuery) return res.json({ events: [], limit: 100 });
            if (!safeQuery) return res.json({ events: [], page, pageSize, total: 0, hasMore: false });
            request = request.or(`steam_id.ilike.%${safeQuery}%,item_id.ilike.%${safeQuery}%,item_name.ilike.%${safeQuery}%`);
        }
        const { data: events, error } = await request;
        const { data: events, error, count } = await request;
        if (error) throw error;
            };
        }), limit: 100 });
        }), page, pageSize, total: count || 0, hasMore: page * pageSize < (count || 0) });
    } catch (error) {
