const { app } = require('@azure/functions');
const { BlobServiceClient, StorageError } = require('@azure/storage-blob');

// Blob Storage の接続文字列
const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

app.http('saveThread', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            context.log('[DEBUG] Starting saveThread function');
            context.log('[DEBUG] Request headers:', request.headers);

            // 接続文字列の確認
            if (!connectionString) {
                const error = new Error('Storage connection string not configured');
                error.code = 'MISSING_CONNECTION_STRING';
                throw error;
            }

            // リクエストボディを JSON として解析
            let body;
            try {
                body = await request.json();
                context.log('[DEBUG] Request body:', JSON.stringify(body, null, 2));
            } catch (parseError) {
                return {
                    status: 400,
                    jsonBody: {
                        error: 'Invalid JSON',
                        details: parseError.message,
                        timestamp: new Date().toISOString()
                    }
                };
            }

            const { id, title, timestamp, posts = [] } = body;

            // バリデーション: 必須項目の確認
            const missingFields = [];
            if (!id) missingFields.push('id');
            if (!title) missingFields.push('title');
            if (!timestamp) missingFields.push('timestamp');

            if (missingFields.length > 0) {
                context.log.error('[ERROR] Missing required fields:', missingFields);
                return {
                    status: 400,
                    jsonBody: {
                        error: 'Invalid Request',
                        details: `Missing required fields: ${missingFields.join(', ')}`,
                        timestamp: new Date().toISOString()
                    }
                };
            }

            try {
                context.log('[DEBUG] Initializing Blob service client');
                const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
                const containerClient = blobServiceClient.getContainerClient('threads');

                // コンテナの存在確認
                context.log('[DEBUG] Checking container existence');
                const containerExists = await containerClient.exists();
                context.log('[DEBUG] Container exists:', containerExists);

                if (!containerExists) {
                    // コンテナが存在しない場合は作成を試みる
                    context.log('[INFO] Container does not exist, creating new container');
                    try {
                        await containerClient.create();
                        context.log('[INFO] Container created successfully');
                    } catch (createError) {
                        context.log.error('[ERROR] Failed to create container:', createError);
                        throw createError;
                    }
                }

                // Blobクライアントの取得と操作
                const blobName = `${id}.json`;
                const blobClient = containerClient.getBlockBlobClient(blobName);

                context.log('[DEBUG] Checking blob existence:', blobName);
                const exists = await blobClient.exists();
                context.log('[DEBUG] Blob exists:', exists);

                let thread;
                if (exists) {
                    // 既存のBlobの読み取り
                    context.log('[DEBUG] Retrieving existing thread');
                    try {
                        const downloadResponse = await blobClient.download();
                        const threadData = await streamToString(downloadResponse.readableStreamBody);
                        thread = JSON.parse(threadData);
                        context.log('[DEBUG] Existing thread retrieved:', thread);
                    } catch (readError) {
                        context.log.error('[ERROR] Failed to read existing thread:', readError);
                        throw readError;
                    }

                    // スレッドの更新
                    thread.title = title;
                    thread.timestamp = timestamp;
                    thread.posts = posts;
                } else {
                    thread = { id, title, timestamp, posts };
                }

                // Blobへの保存
                const updatedData = JSON.stringify(thread, null, 2);
                context.log('[DEBUG] Saving thread data');

                try {
                    await blobClient.upload(Buffer.from(updatedData), updatedData.length, {
                        blobHTTPHeaders: { blobContentType: 'application/json' },
                    });
                    context.log('[INFO] Thread saved successfully:', id);
                } catch (uploadError) {
                    context.log.error('[ERROR] Failed to upload thread:', uploadError);
                    throw uploadError;
                }

                return {
                    status: exists ? 200 : 201,
                    jsonBody: {
                        message: `Thread ${exists ? 'updated' : 'created'} successfully`,
                        thread,
                        timestamp: new Date().toISOString()
                    }
                };

            } catch (blobError) {
                if (blobError instanceof StorageError) {
                    context.log.error('[ERROR] Storage operation failed:', {
                        code: blobError.code,
                        message: blobError.message,
                        details: blobError.details,
                        statusCode: blobError.statusCode,
                        stack: blobError.stack
                    });
                } else {
                    context.log.error('[ERROR] Blob operation failed:', {
                        name: blobError.name,
                        message: blobError.message,
                        stack: blobError.stack,
                        code: blobError.code
                    });
                }
                throw blobError;
            }

        } catch (error) {
            context.log.error('[ERROR] Function failed:', {
                name: error.name,
                message: error.message,
                code: error.code,
                stack: error.stack
            });

            return {
                status: 500,
                jsonBody: {
                    error: "Internal Server Error",
                    details: error.message,
                    code: error.code || 'UNKNOWN_ERROR',
                    timestamp: new Date().toISOString()
                }
            };
        }
    }
});

async function streamToString(readableStream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        readableStream.on('data', (data) => {
            chunks.push(Buffer.from(data));
        });
        readableStream.on('end', () => {
            resolve(Buffer.concat(chunks).toString('utf8'));
        });
        readableStream.on('error', reject);
    });
}