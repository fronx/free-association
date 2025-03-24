{-# LANGUAGE DeriveGeneric, OverloadedStrings, ScopedTypeVariables #-}

module FreeAssociation where

import Transient.Base
import Transient.Move
import Transient.Logged
import Transient.Indeterminism
import Control.Monad.IO.Class
import qualified Data.Map as Map
import qualified Data.Set as Set
import qualified Data.Text as T
import qualified Data.ByteString.Lazy.Char8 as B
import Data.Aeson
import GHC.Generics
import Control.Monad
import Control.Concurrent
import System.Random
import Data.List (sort, sortBy, nub)
import Data.Maybe (fromMaybe)
import Data.Ord (comparing)

-- | Core data types for free association model

-- Participant in the network
data Participant = Participant 
    { participantId :: T.Text
    , name :: T.Text
    , skills :: [T.Text]
    , needs :: [T.Text]
    , goals :: [T.Text]
    } deriving (Show, Eq, Generic)

instance ToJSON Participant
instance FromJSON Participant

-- Recognition quantifies contribution to self-actualization
data Recognition = Recognition
    { fromParticipant :: T.Text
    , toParticipant :: T.Text
    , recognitionValue :: Double  -- Percentage of total recognition (0.0 to 1.0)
    , reason :: T.Text
    } deriving (Show, Eq, Generic)

instance ToJSON Recognition
instance FromJSON Recognition

-- Surplus that can be shared with others
data Surplus = Surplus
    { surplusId :: T.Text
    , sourceParticipant :: T.Text
    , surplusType :: T.Text
    , surplusDescription :: T.Text
    , surplusAmount :: Double
    } deriving (Show, Eq, Generic)

instance ToJSON Surplus
instance FromJSON Surplus

-- Flow represents the amount of surplus that flows from one participant to another
data Flow = Flow
    { surplusRef :: T.Text
    , fromId :: T.Text
    , toId :: T.Text
    , flowAmount :: Double
    , pathLength :: Int       -- How many degrees of separation (1 = direct)
    } deriving (Show, Eq, Generic)

instance ToJSON Flow
instance FromJSON Flow

-- Network State
data NetworkState = NetworkState
    { participants :: Map.Map T.Text Participant
    , recognitions :: [Recognition]
    , surpluses :: [Surplus]
    , flows :: [Flow]
    } deriving (Show, Eq, Generic)

instance ToJSON NetworkState
instance FromJSON NetworkState

-- Message types for inter-node communication
data Message
    = JoinNetwork Participant
    | LeaveNetwork T.Text
    | AddRecognition Recognition
    | UpdateRecognition Recognition
    | RemoveRecognition T.Text T.Text
    | AddSurplus Surplus
    | RemoveSurplus T.Text
    | NetworkStateUpdate NetworkState
    deriving (Show, Eq, Generic)

instance ToJSON Message
instance FromJSON Message

-- | Core free association algorithm implementations

-- Calculate mutual recognition between two participants
mutualRecognition :: NetworkState -> T.Text -> T.Text -> Double
mutualRecognition state id1 id2 =
    let fromId1ToId2 = recognitionValue <$> findRecognition state id1 id2
        fromId2ToId1 = recognitionValue <$> findRecognition state id2 id1
    in case (fromId1ToId2, fromId2ToId1) of
        (Just v1, Just v2) -> min v1 v2  -- Take the minimum for reciprocity
        _ -> 0.0

-- Find a specific recognition between two participants
findRecognition :: NetworkState -> T.Text -> T.Text -> Maybe Recognition
findRecognition state fromId toId =
    let matches = filter (\r -> fromParticipant r == fromId && toParticipant r == toId) (recognitions state)
    in if null matches then Nothing else Just (head matches)

-- Calculate total mutual recognition for a participant
totalMutualRecognition :: NetworkState -> T.Text -> Double
totalMutualRecognition state participantId =
    let allRecognizers = nub $ map fromParticipant $ filter (\r -> toParticipant r == participantId) (recognitions state)
    in sum $ map (\otherId -> mutualRecognition state participantId otherId) allRecognizers

-- Calculate surplus flow for a direct connection
calculateDirectFlow :: NetworkState -> Surplus -> T.Text -> Flow
calculateDirectFlow state surplus recipientId =
    let sourceId = sourceParticipant surplus
        mr = mutualRecognition state sourceId recipientId
        totalMR = totalMutualRecognition state sourceId
        -- Avoid division by zero
        flowRatio = if totalMR > 0 then mr / totalMR else 0.0
    in Flow
        { surplusRef = surplusId surplus
        , fromId = sourceId
        , toId = recipientId
        , flowAmount = surplusAmount surplus * flowRatio
        , pathLength = 1
        }

-- Calculate transitive flows up to N degrees
calculateTransitiveFlows :: NetworkState -> Surplus -> Int -> [Flow]
calculateTransitiveFlows state surplus maxDegrees =
    let sourceId = sourceParticipant surplus
        
        -- Helper function to find all participants who recognize the given participant
        findRecognizers participantId visited depth
            | depth > maxDegrees = []
            | otherwise = 
                let recognizers = filter (\r -> toParticipant r == participantId && 
                                               not (fromParticipant r `elem` visited)) 
                                         (recognitions state)
                    recognizerIds = map fromParticipant recognizers
                    nextVisited = visited ++ recognizerIds
                    
                    -- Direct flows to these recognizers
                    directFlows = map (\recId -> let
                        mr = mutualRecognition state participantId recId
                        totalMR = totalMutualRecognition state participantId
                        flowRatio = if totalMR > 0 then mr / totalMR else 0.0
                        in Flow
                            { surplusRef = surplusId surplus
                            , fromId = participantId
                            , toId = recId
                            , flowAmount = surplusAmount surplus * flowRatio
                            , pathLength = depth
                            }
                        ) recognizerIds
                    
                    -- Recursive flows
                    transitiveFlows = concatMap (\recId -> 
                        findRecognizers recId nextVisited (depth + 1)) recognizerIds
                in
                    directFlows ++ transitiveFlows
    in
        findRecognizers sourceId [sourceId] 1

-- Update network flows based on current recognitions
updateNetworkFlows :: NetworkState -> NetworkState
updateNetworkFlows state =
    let allFlows = concatMap (\s -> calculateTransitiveFlows state s 6) (surpluses state)
        -- Merge flows to the same recipient
        mergedFlows = Map.toList $ 
            Map.fromListWith (\f1 f2 -> f1 { flowAmount = flowAmount f1 + flowAmount f2 }) 
                             [(toId f, f) | f <- allFlows]
    in state { flows = map snd mergedFlows }

-- | Transient Universe implementation

-- Node configuration
data NodeConfig = NodeConfig
    { nodeId :: T.Text
    , seedParticipants :: [Participant]
    , seedRecognitions :: [Recognition]
    , seedSurpluses :: [Surplus]
    , knownNodes :: [String]
    , listenPort :: Int
    } deriving (Show, Generic)

-- Initialize a node with the given configuration
initNode :: NodeConfig -> Cloud ()
initNode config = do
    -- Initialize the node state
    state <- liftIO $ newMVar $ NetworkState
        { participants = Map.fromList [(participantId p, p) | p <- seedParticipants config]
        , recognitions = seedRecognitions config
        , surpluses = seedSurpluses config
        , flows = []
        }
    
    -- Update initial flows
    liftIO $ modifyMVar_ state $ 
        return . updateNetworkFlows
    
    -- Start the node processes
    parallel $ do
        -- Process for handling incoming messages
        messageHandler state
        
        -- Process for disseminating node state periodically
        stateSync state
        
        -- Process for updating flows periodically
        flowUpdater state
        
        -- Add user interface here (command line for demo)
        userInterface state

-- Handle incoming messages
messageHandler :: MVar NetworkState -> Cloud ()
messageHandler state = do
    listen (listenOn $ port 8000) $ runCloud $ do
        msg :: Message <- atRemote receive
        
        liftIO $ modifyMVar_ state $ \currentState -> case msg of
            JoinNetwork participant -> 
                return $ currentState { 
                    participants = Map.insert (participantId participant) participant (participants currentState)
                }
                
            LeaveNetwork participantId ->
                return $ currentState {
                    participants = Map.delete participantId (participants currentState),
                    recognitions = filter (\r -> fromParticipant r /= participantId && toParticipant r /= participantId) 
                                          (recognitions currentState)
                }
                
            AddRecognition recognition ->
                return $ updateNetworkFlows $ currentState {
                    recognitions = recognition : (recognitions currentState)
                }
                
            UpdateRecognition recognition ->
                let filtered = filter (\r -> not (fromParticipant r == fromParticipant recognition && 
                                              toParticipant r == toParticipant recognition)) 
                                      (recognitions currentState)
                in return $ updateNetworkFlows $ currentState {
                    recognitions = recognition : filtered
                }
                
            RemoveRecognition fromId toId ->
                let filtered = filter (\r -> not (fromParticipant r == fromId && toParticipant r == toId)) 
                                      (recognitions currentState)
                in return $ updateNetworkFlows $ currentState {
                    recognitions = filtered
                }
                
            AddSurplus surplus ->
                return $ updateNetworkFlows $ currentState {
                    surpluses = surplus : (surpluses currentState)
                }
                
            RemoveSurplus surplusId ->
                let filtered = filter (\s -> surplusId s /= surplusId) (surpluses currentState)
                in return $ updateNetworkFlows $ currentState {
                    surpluses = filtered
                }
                
            NetworkStateUpdate newState ->
                -- Merge the incoming state with our own
                return $ mergeNetworkStates currentState newState

        messageHandler state  -- Continue handling messages

-- Merge two network states, preferring newer data
mergeNetworkStates :: NetworkState -> NetworkState -> NetworkState
mergeNetworkStates current new =
    NetworkState
        { participants = Map.union (participants new) (participants current) -- Prefer new participants
        , recognitions = nub (recognitions new ++ recognitions current)      -- Combine recognitions
        , surpluses = nub (surpluses new ++ surpluses current)               -- Combine surpluses
        , flows = flows current                                             -- Keep local flow calculations
        }

-- Periodically share node state with known nodes
stateSync :: MVar NetworkState -> Cloud ()
stateSync state = do
    liftIO $ threadDelay 30000000  -- Every 30 seconds
    
    currentState <- liftIO $ readMVar state
    nodes <- knownNodes <$> ask
    
    -- Send state to all known nodes
    forM_ nodes $ \node -> do
        connect node $ do
            atRemote $ send (NetworkStateUpdate currentState)
    
    stateSync state  -- Continue syncing periodically

-- Periodically update flows based on current recognitions
flowUpdater :: MVar NetworkState -> Cloud ()
flowUpdater state = do
    liftIO $ threadDelay 10000000  -- Every 10 seconds
    
    liftIO $ modifyMVar_ state $ 
        return . updateNetworkFlows
    
    flowUpdater state  -- Continue updating periodically

-- Simple command-line interface for interacting with the network
userInterface :: MVar NetworkState -> Cloud ()
userInterface state = do
    liftIO $ putStrLn "Free Association Network Node"
    liftIO $ putStrLn "--------------------------------"
    liftIO $ putStrLn "Commands:"
    liftIO $ putStrLn "  1. View Network State"
    liftIO $ putStrLn "  2. Add Recognition"
    liftIO $ putStrLn "  3. Add Surplus"
    liftIO $ putStrLn "  4. View Flows"
    liftIO $ putStrLn "  5. Exit"
    
    option <- input (const True) "Enter command: "
    
    case option of
        "1" -> do
            currentState <- liftIO $ readMVar state
            liftIO $ putStrLn $ "Participants: " ++ show (Map.size $ participants currentState)
            liftIO $ putStrLn $ "Recognitions: " ++ show (length $ recognitions currentState)
            liftIO $ putStrLn $ "Surpluses: " ++ show (length $ surpluses currentState)
            liftIO $ putStrLn $ "Flows: " ++ show (length $ flows currentState)
            
        "2" -> do
            fromId <- input (const True) "Your ID: "
            toId <- input (const True) "Recipient ID: "
            valueStr <- input (const True) "Recognition value (0.0-1.0): "
            reason <- input (const True) "Reason for recognition: "
            
            let value = read valueStr :: Double
                recognition = Recognition
                    { fromParticipant = T.pack fromId
                    , toParticipant = T.pack toId
                    , recognitionValue = value
                    , reason = T.pack reason
                    }
            
            liftIO $ modifyMVar_ state $ \currentState ->
                return $ updateNetworkFlows $ currentState {
                    recognitions = recognition : (recognitions currentState)
                }
                
            -- Broadcast the new recognition
            nodes <- knownNodes <$> ask
            forM_ nodes $ \node -> do
                connect node $ do
                    atRemote $ send (AddRecognition recognition)
            
        "3" -> do
            sourceId <- input (const True) "Your ID: "
            surplusType <- input (const True) "Surplus type: "
            description <- input (const True) "Description: "
            amountStr <- input (const True) "Amount: "
            
            uuid <- liftIO $ randomIO :: Cloud Integer
            let amount = read amountStr :: Double
                surplus = Surplus
                    { surplusId = T.pack $ show uuid
                    , sourceParticipant = T.pack sourceId
                    , surplusType = T.pack surplusType
                    , surplusDescription = T.pack description
                    , surplusAmount = amount
                    }
            
            liftIO $ modifyMVar_ state $ \currentState ->
                return $ updateNetworkFlows $ currentState {
                    surpluses = surplus : (surpluses currentState)
                }
                
            -- Broadcast the new surplus
            nodes <- knownNodes <$> ask
            forM_ nodes $ \node -> do
                connect node $ do
                    atRemote $ send (AddSurplus surplus)
                    
        "4" -> do
            currentState <- liftIO $ readMVar state
            let sortedFlows = sortBy (comparing flowAmount) (flows currentState)
            liftIO $ putStrLn "Top Flows:"
            forM_ (take 10 sortedFlows) $ \flow ->
                liftIO $ putStrLn $ "  From: " ++ T.unpack (fromId flow) ++ 
                                  " To: " ++ T.unpack (toId flow) ++ 
                                  " Amount: " ++ show (flowAmount flow) ++
                                  " (Path length: " ++ show (pathLength flow) ++ ")"
                                  
        "5" -> do
            liftIO $ putStrLn "Exiting..."
            return ()
            
        _ -> do
            liftIO $ putStrLn "Invalid command"
    
    unless (option == "5") $
        userInterface state  -- Continue UI loop

-- | Main runner and example setup

runFreeAssociation :: IO ()
runFreeAssociation = do
    let nodeCfg = NodeConfig
            { nodeId = "node1"
            , seedParticipants = 
                [ Participant "alice" "Alice" ["coding", "design"] ["housing", "food"] ["build_community"]
                , Participant "bob" "Bob" ["farming", "cooking"] ["tools", "education"] ["sustainable_living"]
                , Participant "carol" "Carol" ["teaching", "writing"] ["transport", "materials"] ["knowledge_sharing"]
                ]
            , seedRecognitions =
                [ Recognition "alice" "bob" 0.3 "Provides food for community"
                , Recognition "bob" "alice" 0.4 "Built website for farm"
                , Recognition "alice" "carol" 0.2 "Teaches programming skills"
                , Recognition "carol" "alice" 0.3 "Built learning platform"
                , Recognition "bob" "carol" 0.3 "Educational content about farming"
                , Recognition "carol" "bob" 0.2 "Food for teaching events"
                ]
            , seedSurpluses =
                [ Surplus "s1" "alice" "code" "Programming time" 20.0
                , Surplus "s2" "bob" "food" "Vegetables from garden" 50.0
                , Surplus "s3" "carol" "education" "Teaching hours" 15.0
                ]
            , knownNodes = ["localhost:8000"]  -- Initially just self for demo
            , listenPort = 8000
            }
            
    keep $ initNode nodeCfg

-- Example of a simple multi-node test network (for simulation purposes)
simulateNetwork :: IO ()
simulateNetwork = do
    putStrLn "Simulating Free Association Network..."
    
    -- Create multiple nodes with different configurations
    -- For a real deployment, these would run on different machines
    let baseNode = NodeConfig
            { nodeId = "base"
            , seedParticipants = []  -- Empty, to be populated during simulation
            , seedRecognitions = []
            , seedSurpluses = []
            , knownNodes = []
            , listenPort = 8000
            }
    
    -- Create a network of 5 nodes with random participants, recognitions, and surpluses
    nodes <- forM [1..5] $ \i -> do
        -- Generate random participants
        participants <- forM [1..5] $ \j -> do
            let pid = T.pack $ "p" ++ show i ++ "_" ++ show j
                pname = T.pack $ "Person " ++ show i ++ "_" ++ show j
            skills <- randomSubset ["coding", "farming", "teaching", "cooking", "writing", "designing"]
            needs <- randomSubset ["housing", "food", "education", "tools", "transport"]
            goals <- randomSubset ["community", "sustainability", "knowledge", "art", "health"]
            return $ Participant pid pname (map T.pack skills) (map T.pack needs) (map T.pack goals)
        
        -- Create some random recognitions between participants
        recognitions <- forM participants $ \p1 -> do
            -- Each participant recognizes 1-3 others
            recCount <- randomRIO (1, 3)
            forM [1..recCount] $ \_ -> do
                p2 <- randomChoice participants
                val <- randomRIO (0.1, 0.5)
                reasons <- randomSubset ["helped me", "taught me", "provided resources", "built something"]
                return $ Recognition (participantId p1) (participantId p2) val (T.pack $ head reasons)
        
        -- Create some random surpluses
        surpluses <- forM participants $ \p -> do
            -- Each participant has 0-2 surpluses
            surpCount <- randomRIO (0, 2)
            forM [1..surpCount] $ \j -> do
                stype <- randomChoice ["food", "code", "education", "space", "tools", "art"]
                amount <- randomRIO (10.0, 100.0)
                return $ Surplus (T.pack $ "s" ++ T.unpack (participantId p) ++ "_" ++ show j)
                                (participantId p)
                                (T.pack stype)
                                (T.pack $ "Surplus " ++ stype)
                                amount
        
        return $ baseNode
            { nodeId = T.pack $ "node" ++ show i
            , seedParticipants = participants
            , seedRecognitions = concat recognitions
            , seedSurpluses = concat surpluses
            , knownNodes = ["localhost:" ++ show (8000 + j) | j <- [0..4], j /= i-1]
            , listenPort = 8000 + i - 1
            }
    
    -- Run all nodes in parallel
    keep $ parallel $ mapM (\n -> do
        liftIO $ putStrLn $ "Starting node: " ++ T.unpack (nodeId n)
        initNode n
        ) nodes

-- Helper functions for simulation
randomSubset :: [a] -> IO [a]
randomSubset items = do
    count <- randomRIO (1, length items)
    indices <- take count <$> shuffle [0..(length items - 1)]
    return $ map (items !!) indices

randomChoice :: [a] -> IO a
randomChoice items = do
    idx <- randomRIO (0, length items - 1)
    return $ items !! idx

shuffle :: [a] -> IO [a]
shuffle xs = do
    let l = length xs
    rands <- forM [0..(l-1)] $ \i -> randomRIO (0, l-1)
    return $ map snd $ sortBy (comparing fst) (zip rands xs)

-- Main entry point
main :: IO ()
main = runFreeAssociation

-- For testing the simulation
mainSim :: IO ()
mainSim = simulateNetwork